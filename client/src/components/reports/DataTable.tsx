import React from 'react';
import type { TableRow } from './types';

interface DataTableProps {
  headers: string[];
  rows: TableRow[];
  maxRows?: number;
}

export default function DataTable({ headers, rows, maxRows = 20 }: DataTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-white">
          <tr>
            {headers.map((header, idx) => (
              <th key={idx} className="px-4 py-2 text-left font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.slice(0, maxRows).map((row, idx) => (
            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              {headers.map((header, cellIdx) => (
                <td key={cellIdx} className="px-4 py-2 text-slate-700">
                  {row[header]?.toString() || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
