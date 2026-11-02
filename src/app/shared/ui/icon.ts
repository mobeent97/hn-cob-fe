import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Battery, Bell, Boxes, Building, Building2,
  Calendar, Car, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, CircleCheck,
  CircleDot, CircleHelp, CircleUser, CircleX, Clock, Command, Copy, Cpu, CreditCard, Download,
  ExternalLink, Eye, EyeOff, FileText, Filter, Fingerprint, Gauge, Globe, Hash, History, Image,
  Info, KeyRound, Layers, LayoutDashboard, Link2, Lock, LogOut, Mail, MapPin, Menu, Moon,
  MoreHorizontal, Navigation, Package, Palette, PanelLeft, Paperclip, Pencil, Percent, Phone, Plus,
  Power, QrCode, Radar, Receipt, RefreshCw, Satellite, ScrollText, Search, Settings, ShieldCheck,
  Signal, SlidersHorizontal, Sparkles, Store, Sun, Tag, Ticket, Trash2, TriangleAlert, Truck,
  Upload, UserRound, Users, UsersRound, Wifi, WifiOff, X, Zap,
  ChartColumnBig, ChartLine, ChartPie, Printer, BellRing, BellOff, Inbox, CalendarClock, TrendingUp,
  Send, Pause, Play, FileSpreadsheet, CheckCheck,
  type IconNode,
} from 'lucide';

/** One outline icon set (Lucide, ISC). Add an icon by importing it and naming it here. */
const ICONS = {
  activity: Activity, 'arrow-down': ArrowDown, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  'arrow-up': ArrowUp, battery: Battery, bell: Bell, boxes: Boxes, building: Building,
  'building-2': Building2, calendar: Calendar, car: Car, check: Check, 'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevrons-up-down': ChevronsUpDown,
  'circle-check': CircleCheck, 'circle-dot': CircleDot, help: CircleHelp, 'circle-user': CircleUser,
  'circle-x': CircleX, clock: Clock, command: Command, copy: Copy, cpu: Cpu, card: CreditCard,
  download: Download, external: ExternalLink, eye: Eye, 'eye-off': EyeOff, file: FileText,
  filter: Filter, fingerprint: Fingerprint, gauge: Gauge, globe: Globe, hash: Hash, history: History,
  image: Image, info: Info, key: KeyRound, layers: Layers, dashboard: LayoutDashboard, link: Link2,
  lock: Lock, logout: LogOut, mail: Mail, pin: MapPin, menu: Menu, moon: Moon, more: MoreHorizontal,
  navigation: Navigation, package: Package, palette: Palette, panel: PanelLeft, paperclip: Paperclip,
  pencil: Pencil, percent: Percent, phone: Phone, plus: Plus, power: Power, qr: QrCode, radar: Radar,
  receipt: Receipt, refresh: RefreshCw, satellite: Satellite, scroll: ScrollText, search: Search,
  settings: Settings, shield: ShieldCheck, signal: Signal, sliders: SlidersHorizontal,
  sparkles: Sparkles, store: Store, sun: Sun, tag: Tag, ticket: Ticket, trash: Trash2,
  alert: TriangleAlert, truck: Truck, upload: Upload, user: UserRound, users: Users,
  'users-round': UsersRound, wifi: Wifi, 'wifi-off': WifiOff, x: X, zap: Zap,
  chart: ChartColumnBig, 'chart-line': ChartLine, 'chart-pie': ChartPie, printer: Printer,
  'bell-ring': BellRing, 'bell-off': BellOff, inbox: Inbox, 'calendar-clock': CalendarClock,
  'trending-up': TrendingUp, send: Send, pause: Pause, play: Play, spreadsheet: FileSpreadsheet,
  'check-check': CheckCheck,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-flex;flex:none', 'aria-hidden': 'true' },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @for (node of nodes(); track $index) {
        @switch (node[0]) {
          @case ('path') { <path [attr.d]="node[1]['d']" /> }
          @case ('circle') { <circle [attr.cx]="node[1]['cx']" [attr.cy]="node[1]['cy']" [attr.r]="node[1]['r']" /> }
          @case ('rect') {
            <rect [attr.x]="node[1]['x']" [attr.y]="node[1]['y']" [attr.width]="node[1]['width']"
              [attr.height]="node[1]['height']" [attr.rx]="node[1]['rx']" [attr.ry]="node[1]['ry']" />
          }
          @case ('line') { <line [attr.x1]="node[1]['x1']" [attr.y1]="node[1]['y1']" [attr.x2]="node[1]['x2']" [attr.y2]="node[1]['y2']" /> }
          @case ('polyline') { <polyline [attr.points]="node[1]['points']" /> }
          @case ('polygon') { <polygon [attr.points]="node[1]['points']" /> }
          @case ('ellipse') { <ellipse [attr.cx]="node[1]['cx']" [attr.cy]="node[1]['cy']" [attr.rx]="node[1]['rx']" [attr.ry]="node[1]['ry']" /> }
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  readonly stroke = input(1.6);
  protected readonly nodes = computed(
    () => ICONS[this.name()] as unknown as [string, Record<string, string>][],
  );
}
