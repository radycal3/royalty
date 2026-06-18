import * as XLSX from 'xlsx'

export function exportToExcel(
  data: Record<string, any>[],
  columns: { key: string; header: string; format?: (v: any) => any }[],
  filename: string
) {
  const rows = data.map((row) => {
    const obj: Record<string, any> = {}
    for (const col of columns) {
      const raw = row[col.key]
      obj[col.header] = col.format ? col.format(raw) : raw
    }
    return obj
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-ancho de columnas
  const colWidths = columns.map((col) => {
    const maxLen = Math.max(
      col.header.length,
      ...rows.map((r) => String(r[col.header] ?? '').length)
    )
    return { wch: Math.min(maxLen + 2, 40) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
