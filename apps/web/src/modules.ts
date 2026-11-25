import type { OrgRole } from '@app/shared';
import {
  Banknote,
  Database,
  Calculator,
  CalendarClock,
  FileSignature,
  FileText,
  Home,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Settings,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  label: string;
  /** Path below /:orgSlug ('' is the dashboard). */
  path: string;
  icon: LucideIcon;
  minRole: OrgRole;
  group: 'Work' | 'Money' | 'Firm' | 'Platform';
  /** Platform admins only (User.isSuperAdmin), whatever their firm role. */
  superAdminOnly?: boolean;
  /** Milestone that ships the real screen; undefined once it exists. */
  comingIn?: string;
  summary: string;
  features?: string[];
}

export const MODULES: ModuleDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '',
    icon: LayoutDashboard,
    minRole: 'READ_ONLY',
    group: 'Work',
    summary: 'Your firm at a glance.',
  },
  {
    key: 'prospects',
    label: 'Prospects',
    path: 'prospects',
    icon: UserPlus,
    minRole: 'READ_ONLY',
    group: 'Work',
    summary: 'Track leads from first contact to signed contract.',
    features: [
      'Pipeline with statuses: New, Contacted, Docs sent, Signed, Lost',
      'Kanban board and list views',
      'Public lead form for your website, with spam protection',
      'Send the contract and Form 50-162 for e-signature in one step',
      'Convert a signed prospect into a client',
    ],
  },
  {
    key: 'clients',
    label: 'Clients',
    path: 'clients',
    icon: Users,
    minRole: 'READ_ONLY',
    group: 'Work',
    summary: 'Every client, their contacts, fee terms and history in one place.',
    features: [
      'Search and filter by county, consultant or unpaid balance',
      'Contingency, flat and BPP fee defaults per client',
      'Tabs for properties, documents, invoices, payments and activity',
      'Archive and restore, with properties archived alongside',
      'Year-end statement PDF',
    ],
  },
  {
    key: 'properties',
    label: 'Properties',
    path: 'properties',
    icon: Home,
    minRole: 'READ_ONLY',
    group: 'Work',
    summary: 'CAD accounts and their values for each tax year.',
    features: [
      'All 254 Texas counties, with CAD links',
      'Notice and final values for each tax year, edited inline',
      'Live fee preview as you type values',
      'Protest stage tracker with full history',
      'Bulk-assign consultants and roll properties into a new tax year',
    ],
  },
  {
    key: 'calculator',
    label: 'Calculator',
    path: 'calculator',
    icon: Calculator,
    minRole: 'READ_ONLY',
    group: 'Work',
    summary:
      'Estimate what a protest would save any home or commercial property, from public appraisal data.',
  },
  {
    key: 'hearings',
    label: 'Hearings',
    path: 'hearings',
    icon: CalendarClock,
    minRole: 'READ_ONLY',
    group: 'Work',
    comingIn: 'M7',
    summary: 'Informal, ARB, arbitration and litigation hearings on one calendar.',
    features: [
      'Week and month calendar, filtered by consultant, county and status',
      'Import hearing schedules from appraisal district CSVs',
      'Personal calendar feed for Google Calendar or Outlook',
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    path: 'documents',
    icon: FileSignature,
    minRole: 'READ_ONLY',
    group: 'Work',
    comingIn: 'M6',
    summary: 'Engagement contracts and Form 50-162, signed electronically.',
    features: [
      'Contract built from your firm’s template',
      'Form 50-162 filled in automatically, covering several accounts',
      'E-signature with status tracking and reminders',
      'Upload documents that were signed on paper',
    ],
  },
  {
    key: 'invoices',
    label: 'Invoices',
    path: 'invoices',
    icon: FileText,
    minRole: 'READ_ONLY',
    group: 'Money',
    comingIn: 'M4',
    summary: 'Contingency invoices calculated from notice and final values.',
    features: [
      'Generate draft invoices per client for a tax year',
      'Fee breakdown on every line: reduction × tax rate × contingency %',
      'Branded PDF with your logo and payment instructions',
      'Bulk email with delivered, opened and bounced tracking (M5)',
    ],
  },
  {
    key: 'payments',
    label: 'Payments',
    path: 'payments',
    icon: Banknote,
    minRole: 'READ_ONLY',
    group: 'Money',
    comingIn: 'M4',
    summary: 'Record payments and apply them to open invoices.',
    features: [
      'Zelle, check, ACH, cash or card, with reference numbers',
      'Partial payments and automatic oldest-first allocation',
      'Client credit for overpayments',
      'Optional receipt email',
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    path: 'finance',
    icon: LineChart,
    minRole: 'ADMIN',
    group: 'Money',
    comingIn: 'M7',
    summary: 'Billed, collected and outstanding, for owners and admins.',
    features: [
      'Billed and collected by month, year to date and calendar year',
      'Collection rate and aging: 0–30, 31–60, 61–90, 90+ days',
      'Charts by month, county and protest outcome',
      'Largest outstanding balances, with CSV export',
    ],
  },
  {
    key: 'imports',
    label: 'Imports',
    path: 'imports',
    icon: Upload,
    minRole: 'STAFF',
    group: 'Firm',
    comingIn: 'M3',
    summary: 'Bring in clients, properties and values from your spreadsheets.',
    features: [
      'Automatic column matching, with a saved mapping per firm',
      'Dry run showing what will be created, updated or skipped',
      'Downloadable error rows',
      'Safe to re-run: no duplicates',
    ],
  },
  {
    key: 'platform-data',
    label: 'Platform data',
    path: 'platform-data',
    icon: Database,
    minRole: 'READ_ONLY',
    group: 'Platform',
    superAdminOnly: true,
    summary: 'What appraisal and firm data the platform holds, county by county.',
  },
  {
    key: 'settings',
    label: 'Settings',
    path: 'settings',
    icon: Settings,
    minRole: 'ADMIN',
    group: 'Firm',
    summary: 'Firm profile, fee defaults, invoicing and team.',
  },
];
