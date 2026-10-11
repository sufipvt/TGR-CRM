// PDFKit drawing helpers for the Reports PDF export.
const PDF_COLORS = {
  brand: '#1a56db', dark: '#111827', gray: '#6b7280',
  lightGray: '#f1f5f9', border: '#e5e7eb', green: '#059669', red: '#dc2626'
};
const STATUS_COLORS_PDF = {
  'New': '#1a56db', 'Working': '#d97706', 'Qualified': '#0d9488',
  'Site Visit Scheduled': '#6b7280', 'Negotiation': '#111827',
  'Booked': '#059669', 'Lost': '#dc2626', 'Not Interested': '#f87171'
};

function pdfHeader(doc, companyName, scopeLabel, from, to) {
  doc.rect(0, 0, doc.page.width, 90).fill(PDF_COLORS.brand);
  doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold').text(companyName, 40, 25);
  doc.fontSize(11).fillColor('#dbeafe').font('Helvetica').text('Performance Report', 40, 50);
  doc.fontSize(9).fillColor('#dbeafe').text(
    'Scope: ' + scopeLabel + '   |   Period: ' + from.toLocaleDateString('en-IN') + ' - ' + to.toLocaleDateString('en-IN'),
    40, 66
  );
  doc.y = 105;
  doc.fillColor(PDF_COLORS.dark).font('Helvetica');
}

function pdfSectionHeader(doc, title) {
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(40, y, 4, 16).fill(PDF_COLORS.brand);
  doc.fontSize(13).fillColor(PDF_COLORS.dark).font('Helvetica-Bold').text(title, 52, y - 1);
  doc.font('Helvetica').fillColor(PDF_COLORS.dark);
  doc.moveDown(0.6);
}

function pdfKpiCards(doc, items) {
  const pageWidth = doc.page.width - 80;
  const gap = 8;
  const boxWidth = (pageWidth - gap * (items.length - 1)) / items.length;
  const startY = doc.y;
  const boxHeight = 54;
  items.forEach((item, i) => {
    const x = 40 + i * (boxWidth + gap);
    const color = item.color || PDF_COLORS.brand;
    doc.fillOpacity(0.10).roundedRect(x, startY, boxWidth, boxHeight, 6).fill(color);
    doc.fillOpacity(1);
    doc.roundedRect(x, startY, boxWidth, boxHeight, 6).lineWidth(1).strokeColor(color).stroke();
    doc.fontSize(16).fillColor(PDF_COLORS.dark).font('Helvetica-Bold')
      .text(String(item.value), x + 10, startY + 10, { width: boxWidth - 20 });
    doc.fontSize(8).fillColor(PDF_COLORS.gray).font('Helvetica')
      .text(item.label, x + 10, startY + 32, { width: boxWidth - 20 });
  });
  doc.y = startY + boxHeight + 14;
}

function pdfTable(doc, headers, rows, colWidths, options = {}) {
  const startX = 40;
  const pageWidth = doc.page.width - 80;
  let y = doc.y;

  function drawHeaderRow() {
    doc.rect(startX, y, pageWidth, 22).fill(PDF_COLORS.dark);
    let hx = startX;
    doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
    headers.forEach((h, i) => { doc.text(h, hx + 8, y + 6, { width: colWidths[i] - 8 }); hx += colWidths[i]; });
    y += 22;
    doc.font('Helvetica').fillColor(PDF_COLORS.dark);
  }
  drawHeaderRow();

  rows.forEach((row, rIdx) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; drawHeaderRow(); }
    const rowHeight = 20;
    if (rIdx % 2 === 1) doc.rect(startX, y, pageWidth, rowHeight).fill(PDF_COLORS.lightGray);
    let x = startX;
    doc.fontSize(9);
    row.forEach((cell, i) => {
      if (options.badgeColumn === i && options.badgeColors) {
        const color = options.badgeColors[cell] || PDF_COLORS.gray;
        const w = Math.min(doc.widthOfString(String(cell)) + 12, colWidths[i] - 12);
        doc.roundedRect(x + 6, y + 4, w, 13, 6).fill(color);
        doc.fontSize(8).fillColor('#ffffff').text(String(cell), x + 12, y + 7, { width: colWidths[i] - 20 });
        doc.fontSize(9).fillColor(PDF_COLORS.dark);
      } else {
        let cellColor = PDF_COLORS.dark;
        if (options.colorRules) {
          const rule = options.colorRules.find(r => r.col === i && r.test(cell));
          if (rule) cellColor = rule.color;
        }
        doc.fillColor(cellColor).text(String(cell), x + 8, y + 5, { width: colWidths[i] - 12 });
        doc.fillColor(PDF_COLORS.dark);
      }
      x += colWidths[i];
    });
    y += rowHeight;
  });
  doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor(PDF_COLORS.border).stroke();
  doc.y = y + 14;
}

function pdfFooter(doc, pageNum, totalPages, companyName) {
  const bottom = doc.page.height - 30;
  doc.fontSize(8).fillColor(PDF_COLORS.gray)
    .text(companyName + ' \u2014 Confidential', 40, bottom, { width: 300 })
    .text('Page ' + pageNum + ' of ' + totalPages, doc.page.width - 140, bottom, { width: 100, align: 'right' });
}

module.exports = {
  PDF_COLORS,
  STATUS_COLORS_PDF,
  pdfHeader,
  pdfSectionHeader,
  pdfKpiCards,
  pdfTable,
  pdfFooter
};
