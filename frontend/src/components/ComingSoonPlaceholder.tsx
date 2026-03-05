import React from 'react';
import { Clock } from 'lucide-react';

interface ComingSoonPlaceholderProps {
  title: string;
  description?: string;
}

export const ComingSoonPlaceholder: React.FC<ComingSoonPlaceholderProps> = ({
  title,
  description,
}) => {
  return (
    <div className="coming-soon-placeholder">
      <div className="coming-soon-content">
        <Clock size={64} className="coming-soon-icon" />
        <h2 className="coming-soon-title">{title}</h2>
        <p className="coming-soon-description">
          {description || 'This feature is currently under development and will be available soon.'}
        </p>
      </div>
    </div>
  );
};
