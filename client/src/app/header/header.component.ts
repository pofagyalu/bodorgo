import { Component, ViewChildren, ElementRef, QueryList } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HeroComponent } from '../hero/hero.component';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { BehaviorSubject } from 'rxjs';

interface NavItemDOMProps {
  width: number;
  height: number;
  left: number;
}
interface NativeElement {
  nativeElement: {
    offsetWidth: number;
    offsetHeight: number;
    offsetLeft: number;
  };
}
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, HeroComponent, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
})
export class HeaderComponent {
  menuShow: boolean = false;
  signedin$: BehaviorSubject<boolean>;

  @ViewChildren('navElements') navElements: QueryList<ElementRef>;

  navItemDOMProps: Array<NavItemDOMProps> | [];
  activeItemWidth: number | undefined;
  activeItemLeftMargin: number | undefined;

  constructor(
    private authService: AuthService,
    public readonly router: Router
  ) {
    this.signedin$ = this.authService.signedin$;
  }

  ngAfterViewChecked() {
    this.getNavItemsDOMWidths(this.navElements.toArray());
    this.calcNewIndicatorDOMStyles();

    // setTimeout(() => {}, 0);
  }

  ngOnInit() {
    this.initialize();
  }

  private initialize() {
    this.navItemDOMProps = [];
    this.activeItemWidth = 0;
    this.activeItemLeftMargin = 0;
  }

  private getNavItemsDOMWidths(navElementsList: any) {
    this.navItemDOMProps = navElementsList.map((item: NativeElement) => ({
      width: item.nativeElement.offsetWidth,
      heigth: item.nativeElement.offsetHeight,
      left: item.nativeElement.offsetLeft,
    }));
  }

  calcNewIndicatorDOMStyles() {
    if (
      this.router.isActive('taborok', {
        paths: 'exact',
        queryParams: 'exact',
        fragment: 'ignored',
        matrixParams: 'ignored',
      })
    ) {
      this.activeItemWidth = this.navItemDOMProps?.[0].width;
      this.activeItemLeftMargin = this.navItemDOMProps?.[0].left;
    }
    if (
      this.router.isActive('shop', {
        paths: 'exact',
        queryParams: 'exact',
        fragment: 'ignored',
        matrixParams: 'ignored',
      })
    ) {
      this.activeItemWidth = this.navItemDOMProps?.[1].width;
      this.activeItemLeftMargin = this.navItemDOMProps?.[1].left;
    }
    if (
      this.router.isActive('rolunk', {
        paths: 'exact',
        queryParams: 'exact',
        fragment: 'ignored',
        matrixParams: 'ignored',
      })
    ) {
      this.activeItemWidth = this.navItemDOMProps?.[2].width;
      this.activeItemLeftMargin = this.navItemDOMProps?.[2].left;
    }
  }

  navToggle() {
    this.menuShow = !this.menuShow;
  }
}
