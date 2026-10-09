import { Directive, Input, OnChanges, TemplateRef, ViewContainerRef, inject } from '@angular/core';

// Makes its element anew whenever the value changes:
//
//   <span *appRecreateOn="score; let s" class="remaining">{{ s }}</span>
//
// For what only starts on a new element: a CSS animation that should play
// again at every new score, a <video> that should start fresh with another
// source. (The same as a one-item `@for (s of [score]; track s)` - which
// works, but Angular takes it for a mistake and warns, NG0956, every time
// the item changes.)
@Directive({ selector: '[appRecreateOn]' })
export class RecreateOn<T> implements OnChanges {
  @Input({ required: true }) appRecreateOn!: T;

  private template = inject<TemplateRef<{ $implicit: T }>>(TemplateRef);
  private container = inject(ViewContainerRef);

  // (Only called when the value really is another one.)
  ngOnChanges() {
    this.container.clear();
    this.container.createEmbeddedView(this.template, { $implicit: this.appRecreateOn });
  }

  // `let s` has the value's own type in the template.
  static ngTemplateContextGuard<T>(
    _directive: RecreateOn<T>,
    _context: unknown,
  ): _context is { $implicit: T } {
    return true;
  }
}
