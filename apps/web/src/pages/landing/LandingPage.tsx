import { APP_CONFIG } from '@app/shared';
import { ArrowRight, Calculator, Check, FileText, MapPinned, Sparkles } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/button';
import { EARLY_ACCESS_HREF, LANDING_ONLY } from '@/lib/site';
import { applyTheme } from '@/lib/theme';

/** The marketing page is always light, whatever the app theme is. */
function useLightPage() {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    return () => applyTheme();
  }, []);
}

/**
 * The main call to action. With the app live it starts a trial; on a landing-only deployment
 * (no API yet) it asks for early access by email instead.
 */
function PrimaryCta({
  children,
  className,
  variant,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'secondary';
}) {
  return (
    <Button asChild size="lg" variant={variant} className={className}>
      {LANDING_ONLY ? (
        <a href={EARLY_ACCESS_HREF}>
          Request early access <ArrowRight />
        </a>
      ) : (
        <Link to="/signup">
          {children} <ArrowRight />
        </Link>
      )}
    </Button>
  );
}

function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** A light, stylized slice of the app: a few properties and the fee they earn. */
function ProductPreview() {
  const rows = [
    ['0660640130020', 'Harris', 'Settled', '$258.00', 'bg-emerald-50 text-emerald-700'],
    ['00000776533000000', 'Dallas', 'Board order', '$1,912.40', 'bg-emerald-50 text-emerald-700'],
    ['R-2847-001-0040-1', 'Collin', 'Hearing', '—', 'bg-amber-50 text-amber-700'],
    ['04237447', 'Tarrant', 'Filed', '—', 'bg-blue-50 text-blue-700'],
  ] as const;
  return (
    <div className="relative mx-auto mt-16 max-w-4xl">
      <div className="absolute -inset-x-10 -top-10 -bottom-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-blue-100 via-sky-50 to-emerald-50 blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-blue-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="ml-3 text-xs text-slate-400">Properties · 2026</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="px-3 py-3 font-medium sm:px-5">Account</th>
              <th className="hidden px-5 py-3 font-medium sm:table-cell">County</th>
              <th className="px-3 py-3 font-medium sm:px-5">Stage</th>
              <th className="px-3 py-3 text-right font-medium sm:px-5">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([acct, county, stage, fee, tone]) => (
              <tr key={acct}>
                <td className="max-w-[7.5rem] truncate px-3 py-3.5 font-mono text-xs text-slate-700 sm:max-w-none sm:px-5">
                  {acct}
                </td>
                <td className="hidden px-5 py-3.5 text-slate-500 sm:table-cell">{county}</td>
                <td className="whitespace-nowrap px-3 py-3.5 sm:px-5">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>
                    {stage}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-medium tabular-nums text-slate-900 sm:px-5">
                  {fee}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="absolute -bottom-8 -right-2 hidden w-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-blue-900/10 sm:block md:-right-10">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Calculator className="size-3.5 text-blue-600" /> Calculated automatically
        </p>
        <p className="mt-2 text-xs text-slate-500">$40,000 × 2.15% × 30%</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">$258.00</p>
      </div>
    </div>
  );
}

const MATH = [
  { value: '$40,000', label: 'value reduction you won' },
  { value: '$860', label: 'your client saves in tax' },
  { value: '$258', label: 'your fee, invoiced' },
];

const SEASON = [
  { when: 'Jan–Mar', what: 'Sign AOAs' },
  { when: 'April', what: 'Notices arrive' },
  { when: 'May', what: 'File protests' },
  { when: 'Jun–Aug', what: 'Hearings' },
  { when: 'Sep+', what: 'Invoice & collect' },
];

const PILLARS = [
  {
    icon: MapPinned,
    title: 'Every account, every county',
    body: 'Clients, CAD accounts and values for all 254 Texas counties. Find any account in a keystroke.',
  },
  {
    icon: Calculator,
    title: 'Fees that do the math',
    body: 'Enter notice and final values. Your contingency fee is worked out to the cent, as you type.',
  },
  {
    icon: FileText,
    title: 'Invoices out, money in',
    body: 'Bill every client for the year in one go, and see who has paid and who hasn’t.',
  },
];

export function LandingPage() {
  useLightPage();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="absolute inset-x-0 top-0 z-30">
        <Container className="flex h-20 items-center justify-between">
          <Logo className="text-base" />
          <div className="flex items-center gap-1 sm:gap-3">
            {LANDING_ONLY ? (
              <Button asChild className="rounded-full px-5">
                <a href={EARLY_ACCESS_HREF}>Get early access</a>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="ghost"
                  className="text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild className="rounded-full px-5">
                  <Link to="/signup">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </Container>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pb-28 pt-36 sm:pt-44">
          <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-gradient-to-b from-blue-50/80 via-white to-white" />
          <Container className="text-center">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
              <Sparkles className="size-4 text-blue-600" />
              For Texas property tax consultants
            </p>
            <h1 className="mx-auto mt-8 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
              Win the protest.
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent">
                Get paid for it.
              </span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              Clients, properties, hearings and contingency invoices in one place, built around
              protest season instead of spreadsheets.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <PrimaryCta className="h-12 rounded-full px-7 text-base">
                Start your free trial
              </PrimaryCta>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="h-12 rounded-full px-6 text-base text-slate-700 hover:bg-slate-100"
              >
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              {LANDING_ONLY ? 'Opening to Texas firms soon' : '14 days free · No card needed'}
            </p>
            <ProductPreview />
          </Container>
        </section>

        {/* The value, in three numbers */}
        <section id="how" className="py-24 sm:py-32">
          <Container>
            <p className="text-center text-sm font-medium uppercase tracking-widest text-blue-600">
              The whole business, in one line
            </p>
            <div className="mt-12 grid items-center gap-6 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
              {MATH.map((m, i) => (
                <div key={m.label} className="contents">
                  <div className="text-center">
                    <p className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
                      {m.value}
                    </p>
                    <p className="mt-3 text-slate-500">{m.label}</p>
                  </div>
                  {i < MATH.length - 1 && (
                    <ArrowRight
                      className="mx-auto size-6 rotate-90 text-slate-300 md:rotate-0"
                      aria-hidden
                    />
                  )}
                </div>
              ))}
            </div>
            <p className="mx-auto mt-12 max-w-xl text-center text-slate-500">
              {APP_CONFIG.displayName} keeps that chain intact for every account, every year, so no
              win goes unbilled.
            </p>
          </Container>
        </section>

        {/* Pillars */}
        <section className="bg-slate-50 py-24 sm:py-32">
          <Container>
            <h2 className="mx-auto max-w-2xl text-center text-4xl font-semibold tracking-tight sm:text-5xl">
              Less admin. More protests.
            </h2>
            <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
              {PILLARS.map((p) => (
                <div key={p.title} className="text-center md:text-left">
                  <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 md:mx-0">
                    <p.icon className="size-6 text-blue-600" />
                  </span>
                  <h3 className="mt-6 text-xl font-semibold">{p.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-600">{p.body}</p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Season timeline */}
        <section className="py-24 sm:py-32">
          <Container>
            <h2 className="mx-auto max-w-2xl text-center text-4xl font-semibold tracking-tight sm:text-5xl">
              Built around your season
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-center text-lg text-slate-600">
              Every property moves from signed AOA to paid invoice, and you always see what’s next.
            </p>
            <ol className="relative mt-16 grid gap-8 sm:grid-cols-5 sm:gap-4">
              <div
                className="absolute left-0 right-0 top-[1.15rem] hidden h-px bg-gradient-to-r from-blue-200 via-blue-300 to-emerald-300 sm:block"
                aria-hidden
              />
              {SEASON.map((s, i) => (
                <li
                  key={s.when}
                  className="relative flex items-center gap-4 sm:block sm:text-center"
                >
                  <span
                    className={`relative flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-4 ring-white sm:mx-auto ${
                      i === SEASON.length - 1
                        ? 'bg-emerald-500 text-white'
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    {i === SEASON.length - 1 ? <Check className="size-4" /> : i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-blue-600 sm:mt-4">{s.when}</p>
                    <p className="mt-0.5 font-semibold">{s.what}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Container>
        </section>

        {/* CTA */}
        <section className="pb-24 sm:pb-32">
          <Container>
            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 to-sky-500 px-6 py-20 text-center text-white sm:px-16">
              <div
                className="absolute -right-24 -top-24 size-72 rounded-full bg-white/10"
                aria-hidden
              />
              <div
                className="absolute -bottom-28 -left-16 size-72 rounded-full bg-white/10"
                aria-hidden
              />
              <h2 className="relative text-4xl font-semibold tracking-tight sm:text-5xl">
                Ready for next season?
              </h2>
              <p className="relative mx-auto mt-5 max-w-lg text-lg text-blue-50">
                {LANDING_ONLY
                  ? 'We’re onboarding our first firms now. Tell us about yours.'
                  : 'Bring your spreadsheet. Be up and running this afternoon.'}
              </p>
              <PrimaryCta
                variant="secondary"
                className="relative mt-10 h-12 rounded-full bg-white px-8 text-base text-blue-700 hover:bg-blue-50"
              >
                Start free trial
              </PrimaryCta>
            </div>
          </Container>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <Container className="flex flex-col items-center justify-between gap-4 py-10 text-sm text-slate-500 sm:flex-row">
          <Logo className="text-sm text-slate-900" />
          <p>
            © {new Date().getFullYear()} {APP_CONFIG.displayName}
          </p>
        </Container>
      </footer>
    </div>
  );
}
