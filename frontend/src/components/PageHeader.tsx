import type { ReactNode } from 'react';
import YucgPhotoBanner from './YucgPhotoBanner';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  imageSrc?: string;
  actions?: ReactNode;
};

export default function PageHeader({
  title,
  subtitle,
  imageSrc = '/yucg-bg/hero-campus.jpg',
  actions,
}: PageHeaderProps) {
  return (
    <div className="app-page-header">
      <YucgPhotoBanner imageSrc={imageSrc} title={title} subtitle={subtitle} variant="hero" />
      {actions ? <div className="app-page-header-actions">{actions}</div> : null}
    </div>
  );
}
