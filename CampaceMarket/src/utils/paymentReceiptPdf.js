import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PAGE_WIDTH = 210;
const MARGIN = 14;
const BLUE = [2, 132, 199];
const NAVY = [15, 23, 42];
const SLATE = [71, 85, 105];
const PALE = [241, 245, 249];
const BORDER = [226, 232, 240];
const GREEN = [22, 163, 74];

const formatEtb = (value) => (
  `${Number(value || 0).toLocaleString('en-ET', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`
);

const safeText = (value, fallback = 'Not available') => (
  String(value ?? '').trim() || fallback
);

const drawLabelValue = (pdf, label, value, x, y, width) => {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...SLATE);
  pdf.text(label.toUpperCase(), x, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  const lines = pdf.splitTextToSize(safeText(value), width);
  pdf.text(lines.slice(0, 2), x, y + 5);
};

const drawSummaryRow = (pdf, label, value, x, y, width, options = {}) => {
  pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
  pdf.setFontSize(options.bold ? 9 : 8);
  pdf.setTextColor(...(options.color || NAVY));
  pdf.text(label, x, y);
  pdf.text(value, x + width, y, { align: 'right' });
};

export function buildPaymentReceiptPdf(receipt) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const paidTotal = Number(receipt.total_paid || 0);
  const itemSubtotal = Number(receipt.item_total || 0);
  const commissionRate = Number(receipt.platform_commission_percent || 0);
  const platformFee = Number(
    receipt.fees ?? (itemSubtotal * commissionRate / 100),
  );
  const sellerSettlement = Math.max(0, paidTotal - platformFee);
  const paidAt = receipt.payment_date || receipt.order_date;
  const dateText = paidAt
    ? new Date(paidAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : 'Date unavailable';
  const productDescription = safeText(receipt.product_name, 'Campus purchase')
    .replace(/\s+/gu, ' ');
  const reference = safeText(receipt.transaction_reference);
  const paymentMethod = safeText(receipt.payment_method, 'Payment');
  const status = safeText(receipt.payment_status, 'Successful').toUpperCase();
  const commissionLabel = commissionRate
    ? `Platform Fee (${commissionRate}%)`
    : 'Platform Fee';

  pdf.setProperties({
    title: `UniXchange Receipt - Order ${receipt.order_number}`,
    subject: 'Official transaction receipt',
    creator: 'UniXchange',
  });

  pdf.setFillColor(...NAVY);
  pdf.roundedRect(MARGIN, 12, PAGE_WIDTH - MARGIN * 2, 34, 3, 3, 'F');
  pdf.setFillColor(...BLUE);
  pdf.roundedRect(20, 20, 15, 15, 3, 3, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(255, 255, 255);
  pdf.text('UX', 27.5, 29.5, { align: 'center' });
  pdf.setFontSize(20);
  pdf.text('UniXchange', 42, 27);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(203, 213, 225);
  pdf.text('UniXchange | Official Transaction Receipt', 42, 35);
  pdf.setFillColor(220, 252, 231);
  pdf.roundedRect(157, 21, 37, 10, 5, 5, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...GREEN);
  pdf.text(status, 175.5, 27.5, { align: 'center' });

  const metaY = 55;
  const metaWidth = (PAGE_WIDTH - MARGIN * 2 - 5) / 2;
  [
    { x: MARGIN, label: 'Receipt number', value: receipt.receipt_number },
    { x: MARGIN + metaWidth + 5, label: 'Date and time', value: dateText },
    { x: MARGIN, label: 'Order number', value: `#${receipt.order_number}` },
    { x: MARGIN + metaWidth + 5, label: 'Payment method', value: paymentMethod },
  ].forEach((item, index) => {
    const y = metaY + (index > 1 ? 17 : 0);
    pdf.setFillColor(...PALE);
    pdf.roundedRect(item.x, y - 5, metaWidth, 14, 2, 2, 'F');
    drawLabelValue(pdf, item.label, item.value, item.x + 3, y, metaWidth - 6);
  });

  const peopleY = 93;
  const peopleWidth = metaWidth;
  [
    { x: MARGIN, label: 'Buyer', value: receipt.buyer_name },
    { x: MARGIN + peopleWidth + 5, label: 'Seller', value: receipt.seller_name },
  ].forEach((item) => {
    pdf.setDrawColor(...BORDER);
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(item.x, peopleY - 5, peopleWidth, 19, 2, 2, 'FD');
    drawLabelValue(pdf, item.label, item.value, item.x + 4, peopleY, peopleWidth - 8);
  });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text('PURCHASED ITEM', MARGIN, 119);
  autoTable(pdf, {
    startY: 123,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Item Description', 'Qty', 'Unit Price', 'Total']],
    body: [[
      productDescription,
      String(receipt.quantity || 1),
      formatEtb(receipt.unit_price),
      formatEtb(itemSubtotal),
    ]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 3,
      lineColor: BORDER,
      lineWidth: 0.2,
      textColor: NAVY,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: BLUE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 91 },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 36, halign: 'right' },
      3: { cellWidth: 39, halign: 'right', fontStyle: 'bold' },
    },
    rowPageBreak: 'avoid',
    pageBreak: 'avoid',
  });

  const sectionY = Math.max(158, pdf.lastAutoTable.finalY + 9);
  const boxWidth = metaWidth;
  const boxHeight = 65;
  const rightX = MARGIN + boxWidth + 5;

  pdf.setDrawColor(...BORDER);
  pdf.setFillColor(...PALE);
  pdf.roundedRect(MARGIN, sectionY, boxWidth, boxHeight, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...NAVY);
  pdf.text('PAYMENT SUMMARY', MARGIN + 5, sectionY + 9);
  const summaryWidth = boxWidth - 10;
  const summaryX = MARGIN + 5;
  drawSummaryRow(pdf, 'Item subtotal', formatEtb(itemSubtotal), summaryX, sectionY + 19, summaryWidth);
  drawSummaryRow(pdf, commissionLabel, `- ${formatEtb(platformFee)}`, summaryX, sectionY + 28, summaryWidth);
  pdf.setDrawColor(...BORDER);
  pdf.line(summaryX, sectionY + 33, summaryX + summaryWidth, sectionY + 33);
  pdf.setFillColor(219, 234, 254);
  pdf.roundedRect(summaryX - 2, sectionY + 36, summaryWidth + 4, 12, 2, 2, 'F');
  drawSummaryRow(
    pdf,
    'TOTAL AMOUNT PAID',
    formatEtb(paidTotal),
    summaryX,
    sectionY + 44,
    summaryWidth,
    { bold: true, color: BLUE },
  );
  drawSummaryRow(
    pdf,
    'Seller net settlement',
    formatEtb(sellerSettlement),
    summaryX,
    sectionY + 57,
    summaryWidth,
    { bold: true },
  );

  pdf.setDrawColor(...BORDER);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(rightX, sectionY, boxWidth, boxHeight, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...NAVY);
  pdf.text('TRANSACTION DETAILS', rightX + 5, sectionY + 9);
  drawLabelValue(pdf, 'Chapa reference', reference, rightX + 5, sectionY + 20, boxWidth - 10);
  drawLabelValue(pdf, 'Payment method', paymentMethod, rightX + 5, sectionY + 38, boxWidth - 10);
  pdf.setFillColor(220, 252, 231);
  pdf.roundedRect(rightX + 5, sectionY + 51, 35, 8, 4, 4, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...GREEN);
  pdf.text(status, rightX + 22.5, sectionY + 56.3, { align: 'center' });

  const footerY = 248;
  pdf.setDrawColor(...BORDER);
  pdf.line(MARGIN, footerY, PAGE_WIDTH - MARGIN, footerY);
  pdf.setFillColor(220, 252, 231);
  pdf.circle(27, footerY + 12, 7, 'F');
  pdf.setDrawColor(...GREEN);
  pdf.setLineWidth(0.7);
  pdf.circle(27, footerY + 12, 5, 'S');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...GREEN);
  pdf.text('VERIFIED', 27, footerY + 12.8, { align: 'center' });
  pdf.setFontSize(10);
  pdf.setTextColor(...NAVY);
  pdf.text('Thank you for choosing UniXchange.', 39, footerY + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...SLATE);
  const footerNote = 'Official digital receipt generated by UniXchange. For support or dispute resolution, contact campus support.';
  pdf.text(pdf.splitTextToSize(footerNote, 148).slice(0, 2), 39, footerY + 13);
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Order #${receipt.order_number} | ${receipt.receipt_number}`, PAGE_WIDTH / 2, 286, {
    align: 'center',
  });

  return pdf;
}

export const paymentReceiptPdfFilename = (orderNumber) => (
  `Campus-Market-Order-${orderNumber}-Receipt.pdf`
);
