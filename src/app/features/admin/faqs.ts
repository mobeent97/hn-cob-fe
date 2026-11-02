import { PortalSettings } from '../../core/data/models';

export type Topic = 'onboarding' | 'devices' | 'billing' | 'account';
export const TOPICS: { id: Topic; label: string }[] = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'devices', label: 'Devices' },
  { id: 'billing', label: 'Billing' },
  { id: 'account', label: 'Account' },
];

export interface Faq {
  id: string;
  topic: Topic;
  q: string;
  /** Paragraphs. */
  a: string[];
  link?: { label: string; to: string };
}

/** Answers that quote a setting read it live, so the help never contradicts the portal. */
export function buildFaqs(s: PortalSettings): Faq[] {
  return [
    // ── Onboarding ──
    {
      id: 'onb-steps', topic: 'onboarding', q: 'How do I onboard a new customer?',
      a: [
        'Go to Customers and choose New customer. Onboarding has nine sections: general details, documents, package, customer type, features, admins, hardware, shipment and installation, and branding.',
        'Each section saves on its own, so you can stop at any point. The customer shows as "Onboarding 4/9" in the list until every section is done; pick Continue onboarding from its menu to carry on.',
      ],
      link: { label: 'Open customers', to: '/customers' },
    },
    {
      id: 'onb-docs', topic: 'onboarding', q: 'Which documents does a customer need to provide?',
      a: [
        'The trade licence and the signed contract are needed for every business customer. Add a copy of the authorised signatory\'s ID when the contract is signed by someone other than the main contact.',
        'Documents are uploaded in the Documents section and stay on the customer\'s detail page for later reference.',
      ],
    },
    {
      id: 'onb-usecase', topic: 'onboarding', q: 'What is the difference between a use case and a package?',
      a: [
        'A use case is what the customer does with the platform, such as Fleet Management System or Cold Chain Monitoring. It decides which modules they see.',
        'A package is the tier they pay for (Basic, Plug & Go, Advance or Enterprise). The feature matrix on the Packages screen decides which features each package includes.',
      ],
      link: { label: 'Open packages', to: '/packages' },
    },
    {
      id: 'onb-delete', topic: 'onboarding', q: 'How do I delete a customer?',
      a: [
        'Deactivate the customer first, then choose Request deletion from its menu. A super admin approves it on the Deletion audit screen.',
        'On approval the account is removed, its devices go back to stock as Available, and the deletion is logged with who requested and approved it. Until then the request can be cancelled.',
      ],
      link: { label: 'Open deletion audit', to: '/audit' },
    },
    // ── Devices ──
    {
      id: 'dev-status', topic: 'devices', q: 'What do the device statuses mean?',
      a: [
        'Available: in stock. Allocated: assigned to a customer but not installed yet. Sold: installed and in service. Faulty: held for RMA. Deactivated: the customer\'s account was deactivated.',
        'Only Sold devices count as "in service" on the overview and on a customer\'s device total.',
      ],
    },
    {
      id: 'dev-allocate', topic: 'devices', q: 'How do I assign devices to a customer?',
      a: [
        'In Inventory, filter to Available, tick the devices and choose Allocate. Pick the customer; the devices move to Allocated.',
        'A device must match the customer\'s package: a Plug & Go customer can only take the self-installed OBD tracker, for example. Devices become Sold once they are installed on a vehicle.',
      ],
      link: { label: 'Open inventory', to: '/inventory' },
    },
    {
      id: 'dev-silent', topic: 'devices', q: 'A device has stopped reporting. How do I check it?',
      a: [
        'Open Diagnostic parameters and choose Test on a device. It reads ignition, GSM signal, external and battery voltage and, where the device supports it, odometer and RPM.',
        'One bar of GSM points to poor coverage where the vehicle is parked. External voltage below about 11.8 V usually means a wiring or vehicle-battery problem. If both look fine, send Request position or Reboot from Device actions.',
      ],
      link: { label: 'Open diagnostics', to: '/diagnostics/parameters' },
    },
    {
      id: 'dev-immobilise', topic: 'devices', q: 'Why do I have to type the plate to immobilise an engine?',
      a: [
        'Immobilising stops the engine from starting until someone sends the release command, so the portal asks you to type the vehicle\'s plate to make sure the command goes to the right vehicle.',
        'Only immobilise a vehicle that is parked. The status line shows Acknowledged once the device confirms it.',
      ],
    },
    // ── Billing ──
    {
      id: 'bill-how', topic: 'billing', q: 'How is a customer billed?',
      a: [
        'Each package has a monthly price per device. A customer pays that price for every device in service (Sold). Allocated devices that aren\'t installed yet are not billed.',
        'Hardware is ordered separately on the Hardware orders screen.',
      ],
    },
    {
      id: 'bill-voucher', topic: 'billing', q: 'How do voucher codes work?',
      a: [
        'A voucher gives a percentage off (1–90%) when the spend falls between its minimum and maximum, for one use case, until it expires. Codes are 4–16 capital letters and digits; use Generate code for a unique one.',
        'Once a voucher has been redeemed its code and terms are locked, but you can still extend the expiry or disable it. A voucher past its expiry date shows as Expired on its own.',
      ],
      link: { label: 'Open vouchers', to: '/vouchers' },
    },
    // ── Account ──
    {
      id: 'acc-locked', topic: 'account', q: 'I\'m locked out or forgot my password. What now?',
      a: [
        `After ${s.login.maxAttempts} wrong passwords your account locks for ${s.login.lockMinutes} minutes. Wait, or choose Forgot password on the sign-in page to get a reset link by email${s.login.otpOnReset ? ', followed by a one-time code' : ''}.`,
        `A new password needs at least ${s.password.minLength} characters${s.password.requireNumber ? ', a number' : ''}${s.password.requireSymbol ? ' and a symbol' : ''}${s.password.history ? `, and can't be one of your last ${s.password.history}` : ''}.`,
      ],
    },
    {
      id: 'acc-access', topic: 'account', q: 'How do I give a colleague access to the portal?',
      a: [
        'Go to Users and choose New user. They receive an email to set their password. What they can see comes from their groups: each group sets None, Read, or Read & write per screen.',
        'If no group fits, create one on the Groups screen. Super admins can also approve deletions and manage users.',
      ],
      link: { label: 'Open users', to: '/users' },
    },
    {
      id: 'acc-session', topic: 'account', q: 'Why was I signed out?',
      a: [
        `Sessions end after ${s.login.sessionMinutes} minutes without activity. Changing your password also signs out your other sessions.`,
        `Lists show ${s.pagination.pageSize} rows per page; a super admin can change this and the session timeout in Settings.`,
      ],
    },
  ];
}
