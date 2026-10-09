import {
  Component,
  OnInit,
  ElementRef,
  HostListener,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { TabOption, TabStrip } from '../../../components/tab-strip/tab-strip';
import { fadeIn } from '../../../shared/fade-in';
import { PhotoGalleryService } from '../../../shared/photo-gallery';
import { MediaEdit, MediaEditDialog } from '../../../shared/media-edit-dialog/media-edit-dialog';
import {
  MediaPhoto,
  MediaPhotoAlbum,
  MediaPhotoCategory,
  MediaService,
  albumKey,
  photoNewCount,
} from '../../../services/media';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';

// Média → Fotók: every category (/media/fotok), or just one
// (/media/fotok/<folder>) as picked in the Média sidebar. A category is a
// subfolder of the NAS's bódorgó_egyéb (found by the sidebar's "Új média
// felfedezése"); its photos open in the app's shared photo viewer, like
// the tour albums'. A photo has a name only if an admin gave it one - its
// file name is never shown.
//
// A folder inside a category's is an album of it (the carnivals' years):
// the category shows a card for each, and one album's photos are a page of
// their own (/media/fotok/<folder>/<album>) - so years of photos are never
// one heap.
@Component({
  selector: 'app-media-photos',
  imports: [MatIconModule, MediaEditDialog, NgTemplateOutlet, RouterLink, TabStrip],
  templateUrl: './photos.html',
  styleUrl: './photos.scss',
})
export class Photos implements OnInit {
  media = inject(MediaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  categoryKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('category'))), {
    initialValue: null,
  });
  albumKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('album'))), {
    initialValue: null,
  });
  // A phone's category tabs under the title (a wide screen has the Média
  // sidebar): "Összes", then the categories, each with its count.
  categoryOptions = computed<TabOption[]>(() => [
    { value: 'all', label: 'Összes', count: this.totalCount() },
    ...this.media.photoCategories().map((c) => ({
      value: c.key,
      label: c.title,
      count: c.count,
    })),
  ]);

  chooseCategory(key: string) {
    void this.router.navigate(key === 'all' ? ['/media/fotok'] : ['/media/fotok', key]);
  }

  // The categories' panels: fade in when another category or album is picked.
  private groups = viewChild<ElementRef<HTMLElement>>('groups');

  constructor() {
    afterRenderEffect(() => {
      this.categoryKey();
      this.albumKey();
      fadeIn(this.groups()?.nativeElement);
    });
    // An opened album's photos are fetched then - and again after a
    // discovery has emptied what was kept.
    effect(() => {
      const category = this.category();
      const album = this.album();
      if (category && album && !this.albumPhotos()) this.media.loadAlbum(category.key, album.key);
    });
  }

  shownCategories = computed(() => {
    const key = this.categoryKey();
    const all = this.media.photoCategories();
    return key ? all.filter((c) => c.key === key) : all;
  });
  unknownCategory = computed(
    () =>
      !!this.categoryKey() &&
      this.media.photoCategories().length > 0 &&
      !this.shownCategories().length,
  );
  totalCount = computed(() => this.media.photoCategories().reduce((sum, c) => sum + c.count, 0));
  // Admins: how many of a category's photos carry "Új".
  photoNewCount = photoNewCount;

  // --- An opened album ---

  category = computed(
    () => this.media.photoCategories().find((c) => c.key === this.categoryKey()) ?? null,
  );
  album = computed(() => this.category()?.albums.find((a) => a.key === this.albumKey()) ?? null);
  private openedKey = computed(() => albumKey(this.categoryKey() ?? '', this.albumKey() ?? ''));
  // Not there yet: on their way (or albumFailed).
  albumPhotos = computed<MediaPhoto[] | undefined>(
    () => this.media.albumPhotos()[this.openedKey()],
  );
  albumFailed = computed(() => this.media.albumError() === this.openedKey());

  // The category's other albums, all at once, under the album's name - one
  // tap picks and closes.
  albumsOpen = signal(false);

  toggleAlbums(event: Event) {
    // Not the document's click below, which would close it right away.
    event.stopPropagation();
    this.albumsOpen.update((open) => !open);
  }

  pickAlbum(category: MediaPhotoCategory, album: MediaPhotoAlbum) {
    this.albumsOpen.set(false);
    void this.router.navigate(['/media/fotok', category.key, album.key]);
  }

  // A click anywhere else, or Esc, closes the panel without choosing.
  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeAlbums() {
    this.albumsOpen.set(false);
  }

  thumbUrl(category: string, filename: string): string {
    return this.media.photoThumbUrl(category, filename);
  }

  // The app's shared photo viewer (shared/photo-gallery) - the same as the
  // tour albums': full screen, download, and the thumbnail strip. It goes
  // through the photos shown together: a category's own, or one album's.
  private gallery = inject(PhotoGalleryService);

  open(category: string, photos: MediaPhoto[], index: number) {
    void this.gallery.open(
      photos.map((p) => ({
        name: p.filename,
        caption: p.title,
        width: p.width,
        height: p.height,
        thumbUrl: this.media.photoThumbUrl(category, p.filename),
        fullUrl: this.media.photoUrl(category, p.filename),
        downloadUrl: this.media.photoDownloadUrl(category, p.filename),
        isNew: p.isNew,
      })),
      index,
    );
  }

  // --- The role manager: a photo's name and who may see it (the pencil on its tile,
  // shared/media-edit-dialog) ---

  private auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  // Only the role manager's - no other admin's.
  canEdit = computed(() => !!this.auth.user()?.canManageRoles);

  editing = signal<{ category: string; photo: MediaPhoto } | null>(null);
  savingEdit = signal(false);
  editError = signal<string | null>(null);

  startEdit(category: string, photo: MediaPhoto) {
    this.editError.set(null);
    this.editing.set({ category, photo });
  }

  saveEdit(edit: MediaEdit) {
    const e = this.editing();
    if (!e || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.editError.set(null);
    this.media.updatePhoto(e.category, e.photo.filename, edit).subscribe({
      next: () => {
        this.savingEdit.set(false);
        this.editing.set(null);
        this.notifications.addSuccess('Mentve');
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.editError.set(err?.error?.message ?? 'Hiba történt a mentés során.');
      },
    });
  }

  // --- The role manager: a category's or an album's name and who may see it (the
  // pencil in its heading), and an album's cover (on a photo's tile) ---

  // album null: the category itself.
  editingFolder = signal<{ category: MediaPhotoCategory; album: MediaPhotoAlbum | null } | null>(
    null,
  );

  startFolderEdit(category: MediaPhotoCategory, album: MediaPhotoAlbum | null = null) {
    this.editError.set(null);
    this.editingFolder.set({ category, album });
  }

  saveFolderEdit(edit: MediaEdit) {
    const e = this.editingFolder();
    if (!e || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.editError.set(null);
    const saving = e.album
      ? this.media.updateAlbum(e.category.key, e.album.key, edit)
      : this.media.updateCategory(e.category.key, edit);
    saving.subscribe({
      next: () => {
        this.savingEdit.set(false);
        this.editingFolder.set(null);
        this.notifications.addSuccess('Mentve');
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.editError.set(err?.error?.message ?? 'Hiba történt a mentés során.');
      },
    });
  }

  // This photo on the album's card from now.
  setCover(category: string, album: MediaPhotoAlbum, photo: MediaPhoto) {
    if (album.cover === photo.filename) return;
    this.media.updateAlbum(category, album.key, { cover: photo.filename }).subscribe({
      next: () => this.notifications.addSuccess('Ez lett az album borítója'),
      error: (err) =>
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.'),
    });
  }

  ngOnInit() {
    this.media.loadPhotos();
  }
}
