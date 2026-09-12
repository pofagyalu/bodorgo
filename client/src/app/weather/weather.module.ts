// Angular 20 defaults components to standalone: true, so ForecastComponent
// can no longer be declared in an NgModule - it's imported directly wherever
// it's used (see home.component.ts). This module is kept only for
// reference, not wired up anywhere.

// import { NgModule } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ForecastComponent } from './forecast/forecast.component';

// @NgModule({
//   declarations: [ForecastComponent],
//   imports: [CommonModule],
//   exports: [ForecastComponent],
// })
// export class WeatherModule {}
