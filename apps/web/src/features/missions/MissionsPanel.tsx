import { useTranslation } from 'react-i18next';

export function MissionsPanel() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="missions-title">
      <h2 id="missions-title">{t('missions.title')}</h2>
      <p className="lede">{t('missions.signedOut')}</p>
      <p className="alert alert-info">{t('missions.comingSoon')}</p>
    </section>
  );
}
