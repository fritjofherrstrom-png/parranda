import { buildWalkingContinuation } from '../../lib/walking-continuation.mjs';
import type { RouteEnd, RoutePoint } from '../../lib/maps-links.mjs';
import { buttonClass } from '../shared/ui';
import { ExternalIcon, WalkIcon } from '../shared/icons';
import type { Translate } from './copy';
import type { PositionSession } from './useFollowPosition';

/** An opt-in continuation leaves the original full-day Maps action untouched. */
export default function WalkingContinuation({ t, stops, follow, enabled, destination = null }: {
  t: Translate;
  stops: RoutePoint[];
  follow: PositionSession;
  enabled: boolean;
  destination?: RoutePoint | null;
}) {
  const plan = buildWalkingContinuation({
    stops, enabled,
    position: follow.state.status === 'tracking' ? follow.state.position : null,
    destination,
  });
  if (!plan) return null;
  const stopName = String(plan.fromStop.label || plan.fromStop.name || '').trim();
  const endName = (end: RouteEnd) => end.kind === 'origin'
    ? t('Din position', 'Your position')
    : String(end.point.label || end.point.name || '').trim()
      || (end.kind === 'destination' ? t('Dagens slut', "The day's finish") : t('Stopp', 'Stop'));
  const linkClass = buttonClass('secondary', 'min-h-11 px-3 text-13');
  return (
    <div data-walking-continuation className="mb-3 flex flex-col items-start gap-1.5">
      <p className="text-13 text-parranda-ink-muted">
        {stopName
          ? t(`Från ${stopName} vidare. Dagen ändras inte.`, `From ${stopName} onward. Your day stays unchanged.`)
          : t('Fortsätt med den här delen av dagen. Dagen ändras inte.', 'Continue with this part of the day. Your day stays unchanged.')}
      </p>
      {plan.parts.length === 1 ? (
        <a href={plan.parts[0].url} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <WalkIcon className="h-4 w-4" />
          {t('Fortsätt härifrån i Maps', 'Continue from here in Maps')}
          <ExternalIcon className="h-3.5 w-3.5" />
        </a>
      ) : (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-13 font-semibold text-parranda-ink-soft">
            <WalkIcon className="h-4 w-4" />{t('Fortsätt härifrån i Maps', 'Continue from here in Maps')}
          </summary>
          <p className="max-w-prose text-xs text-parranda-ink-meta">
            {t('Gå sträckorna i ordning. Varje sträcka fortsätter där den förra slutar.', 'Walk these stretches in order. Each continues where the previous one ends.')}
          </p>
          <ol className="mt-1 flex flex-col items-start gap-1">
            {plan.parts.map((part, index) => (
              <li key={index}>
                <a href={part.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {endName(part.from)} → {endName(part.to)}<ExternalIcon className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
