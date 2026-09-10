import DOMPurify from 'dompurify';

/** Explicit display contract for member/imported/generated email HTML. No CSS, SVG,
 * forms, embedded documents, event handlers, or relative/protocol-relative URLs. */
const tags = ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'blockquote', 'pre', 'code', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'img', 'font', 'table', 'tbody', 'thead', 'tr', 'td', 'th'];
const attrs = ['href', 'src', 'alt', 'title', 'width', 'height', 'color', 'colspan', 'rowspan'];

export function safeImageUrl(value: string): string {
  if (/^https:\/\//i.test(value) || /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  return '';
}

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'href') data.keepAttr = node.nodeName === 'A' && /^(?:https?:\/\/|mailto:)/i.test(data.attrValue);
  if (data.attrName === 'src') data.keepAttr = node.nodeName === 'IMG' && Boolean(safeImageUrl(data.attrValue));
  if (['width', 'height', 'colspan', 'rowspan'].includes(data.attrName)) data.keepAttr = /^\d{1,4}$/.test(data.attrValue);
  if (data.attrName === 'color') data.keepAttr = /^(?:#[0-9a-f]{3,8}|[a-z]{1,20})$/i.test(data.attrValue);
});

export function sanitizeRichText(value: string): string {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attrs,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    // URI hooks above further restrict each element and attribute.
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
  });
}

/** Browser paste/drop must be sanitized before it enters a live editable node. */
export function insertSafeTransfer(transfer: DataTransfer): void {
  const html = transfer.getData('text/html');
  if (html) document.execCommand('insertHTML', false, sanitizeRichText(html));
  else document.execCommand('insertText', false, transfer.getData('text/plain'));
}
