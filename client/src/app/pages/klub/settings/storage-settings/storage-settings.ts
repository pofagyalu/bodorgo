import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ChatImageSettings,
  ImageCacheSettings,
  SettingsService,
} from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';

// Klub → Beállítások → Tárhely: the room the photos take - the chat's, and
// the picture cache. One of the settings page's tabs (settings.ts shows
// them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-storage-settings',
  imports: [FormsModule],
  templateUrl: './storage-settings.html',
  styleUrl: './storage-settings.scss',
})
export class StorageSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  ngOnInit() {
    this.loadChatImages();
    this.loadImageCache();
  }

  // --- Chat fotók: the folder's size limit and the daily number per person ---

  chatImages = signal<ChatImageSettings | null>(null);
  chatQuotaMB = signal(1024);
  chatDailyLimit = signal(10);
  savingChatImages = signal(false);

  chatImagesDirty = computed(() => {
    const c = this.chatImages();
    return (
      !!c &&
      (c.quotaMB !== Number(this.chatQuotaMB()) || c.dailyLimit !== Number(this.chatDailyLimit()))
    );
  });

  // How full the folder is, 0-100.
  chatUsagePercent = computed(() => {
    const c = this.chatImages();
    if (!c) return 0;
    return Math.min(100, Math.round((c.usage.bytes / (c.quotaMB * 1024 * 1024)) * 100));
  });

  chatUsageMB = computed(() => Math.round((this.chatImages()?.usage.bytes ?? 0) / (1024 * 1024)));

  private loadChatImages() {
    this.settingsService.getChatImageSettings().subscribe({
      next: (res) => this.applyChatImages(res.data),
      error: () => {},
    });
  }

  applyChatImages(c: ChatImageSettings) {
    this.chatImages.set(c);
    this.chatQuotaMB.set(c.quotaMB);
    this.chatDailyLimit.set(c.dailyLimit);
  }

  saveChatImages() {
    if (this.savingChatImages()) return;
    this.savingChatImages.set(true);
    this.settingsService
      .updateChatImageSettings({
        quotaMB: Number(this.chatQuotaMB()),
        dailyLimit: Number(this.chatDailyLimit()),
      })
      .subscribe({
        next: (res) => {
          this.applyChatImages(res.data);
          this.savingChatImages.set(false);
          this.notifications.addSuccess(
            res.data.removed
              ? `Kotyogó fotók mentve – ${res.data.removed} régi fotó törölve, hogy beférjen.`
              : 'Kotyogó fotók mentve.',
          );
        },
        error: (err) => {
          this.savingChatImages.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  // --- Kép gyorsítótár: the smaller photo versions for the viewer ---

  imageCache = signal<ImageCacheSettings | null>(null);
  imageCacheQuotaMB = signal(5120);
  savingImageCache = signal(false);

  imageCacheDirty = computed(() => {
    const c = this.imageCache();
    return !!c && c.quotaMB !== Number(this.imageCacheQuotaMB());
  });

  imageCachePercent = computed(() => {
    const c = this.imageCache();
    if (!c) return 0;
    return Math.min(100, Math.round((c.usage.bytes / (c.quotaMB * 1024 * 1024)) * 100));
  });

  imageCacheUsageMB = computed(() =>
    Math.round((this.imageCache()?.usage.bytes ?? 0) / (1024 * 1024)),
  );

  private loadImageCache() {
    this.settingsService.getImageCacheSettings().subscribe({
      next: (res) => this.applyImageCache(res.data),
      error: () => {},
    });
  }

  applyImageCache(c: ImageCacheSettings) {
    this.imageCache.set(c);
    this.imageCacheQuotaMB.set(c.quotaMB);
  }

  saveImageCache() {
    if (this.savingImageCache()) return;
    this.savingImageCache.set(true);
    this.settingsService.updateImageCacheSettings(Number(this.imageCacheQuotaMB())).subscribe({
      next: (res) => {
        this.applyImageCache(res.data);
        this.savingImageCache.set(false);
        this.notifications.addSuccess(
          res.data.removed
            ? `Kép gyorsítótár mentve – ${res.data.removed} régóta nem nézett kép törölve, hogy beférjen.`
            : 'Kép gyorsítótár mentve.',
        );
      },
      error: (err) => {
        this.savingImageCache.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  async clearImageCache() {
    if (this.savingImageCache()) return;
    const ok = await this.confirm.ask({
      message: 'Biztosan üríted a kép gyorsítótárat?',
      detail:
        'Az eredeti fotók megmaradnak – a kisebb változatok újra elkészülnek, ahogy megnézik őket.',
      confirmText: 'Ürítés',
    });
    if (!ok) return;
    this.savingImageCache.set(true);
    this.settingsService.clearImageCache().subscribe({
      next: (res) => {
        this.applyImageCache(res.data);
        this.savingImageCache.set(false);
        this.notifications.addSuccess(
          `Kép gyorsítótár kiürítve – ${res.data.removed} kép törölve.`,
        );
      },
      error: (err) => {
        this.savingImageCache.set(false);
        this.notifications.addError(err?.error?.message ?? 'Az ürítés nem sikerült.');
      },
    });
  }
}
