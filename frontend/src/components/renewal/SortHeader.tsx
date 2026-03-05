import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import type { SortField, SortConfig } from '../../types/renewal';

interface SortHeaderProps {
  label: string;
  field: SortField;
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
}

export const SortHeader: React.FC<SortHeaderProps> = ({ label, field, sortConfig, onSort }) => {
  const isActive = sortConfig.field === field && sortConfig.direction !== null;

  return (
    <th
      className="renewal-sortable-header"
      onClick={() => onSort(field)}
    >
      <div className="renewal-header-content">
        <span>{label}</span>
        <span className={`renewal-sort-icon ${isActive ? 'active' : ''}`}>
          {sortConfig.field === field && sortConfig.direction === 'asc' ? (
            <ChevronUp size={14} />
          ) : sortConfig.field === field && sortConfig.direction === 'desc' ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronsUpDown size={14} />
          )}
        </span>
      </div>
    </th>
  );
};
