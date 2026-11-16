import { useTranslation } from 'react-i18next';
import { IconGlobe, IconRover } from './icons';

/**
 * Copernico's two modes, side by side wherever either is open: the planner (planner.html) and the
 * rover game (play.html). They are separate pages (the planner does not load the game's code), so
 * the other mode is a link.
 */
export function ModeSwitch({ current }: { current: 'planner' | 'game' }) {
  const { t } = useTranslation();
  const modes = [
    { id: 'planner', href: './planner.html', Icon: IconGlobe },
    { id: 'game', href: './play.html', Icon: IconRover },
  ] as const;
  return (
    <nav className="mode-switch" aria-label={t('modes.label')}>
      {modes.map(({ id, href, Icon }) =>
        id === current ? (
          <span
            key={id}
            className="mode-switch-item is-on"
            aria-current="page"
            title={t(`modes.${id}Hint`)}
          >
            <Icon aria-hidden="true" />
            <span className="mode-switch-label">{t(`modes.${id}`)}</span>
          </span>
        ) : (
          <a key={id} className="mode-switch-item" href={href} title={t(`modes.${id}Hint`)}>
            <Icon aria-hidden="true" />
            <span className="mode-switch-label">{t(`modes.${id}`)}</span>
          </a>
        ),
      )}
    </nav>
  );
}
