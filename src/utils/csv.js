// CSV cell escaping. Quotes/commas/newlines are wrapped and doubled per
// RFC 4180, and a leading = + - @ (or tab/CR) is neutralised with a
// single quote so a hostile student name like `=HYPERLINK(...)` can't
// run as a formula when the admin opens the export in Excel/Sheets.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

module.exports = { csvCell, csvRow };
