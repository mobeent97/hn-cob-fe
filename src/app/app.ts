import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToasterHost } from './shared/ui/toast';

@Component({
  imports: [RouterOutlet, ToasterHost],
  selector: 'app-root',
  template: `<router-outlet /><app-toaster />`,
})
export class App {}
