import { useMemo, useId } from "react";

interface PaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [50, 100, 500],
}: PaginationProps) {
  const pageSizeId = useId();
  const totalPages = useMemo(() => {
    if (pageSize === -1) return 1; // "All" selected
    return Math.ceil(totalItems / pageSize);
  }, [totalItems, pageSize]);

  const startItem = useMemo(() => {
    if (totalItems === 0) return 0;
    if (pageSize === -1) return 1;
    return (currentPage - 1) * pageSize + 1;
  }, [currentPage, pageSize, totalItems]);

  const endItem = useMemo(() => {
    if (pageSize === -1) return totalItems;
    return Math.min(currentPage * pageSize, totalItems);
  }, [currentPage, pageSize, totalItems]);

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = parseInt(e.target.value, 10);
    onPageSizeChange(newSize);
    onPageChange(1); // Reset to first page when changing page size
  };

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <div className="pagination-container">
      <div className="pagination-info">
        <span className="pagination-showing">
          Showing {startItem}-{endItem} of {totalItems.toLocaleString()}
        </span>
      </div>

      <div className="pagination-controls">
        <div className="pagination-size">
          <label htmlFor={pageSizeId}>Show:</label>
          <select
            id={pageSizeId}
            value={pageSize}
            onChange={handlePageSizeChange}
            className="pagination-size-select"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value={-1}>All</option>
          </select>
        </div>

        {pageSize !== -1 && totalPages > 1 && (
          <div className="pagination-nav">
            <button
              className="pagination-btn"
              onClick={() => onPageChange(1)}
              disabled={!canGoPrevious}
              title="First page"
            >
              ««
            </button>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={!canGoPrevious}
              title="Previous page"
            >
              «
            </button>
            <span className="pagination-page-info">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={!canGoNext}
              title="Next page"
            >
              »
            </button>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(totalPages)}
              disabled={!canGoNext}
              title="Last page"
            >
              »»
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook to handle pagination logic
export function usePagination<T>(items: T[], pageSize: number, currentPage: number): T[] {
  return useMemo(() => {
    if (pageSize === -1) return items; // "All" selected
    const startIndex = (currentPage - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, pageSize, currentPage]);
}
