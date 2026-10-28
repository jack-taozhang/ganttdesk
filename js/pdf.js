'use strict';

/* Minimal PDF writer for the export path: every rendered sheet becomes one
   A3 page holding a JPEG image. Keeping it dependency-free means the desktop
   build exports a real PDF file directly instead of relying on a print popup,
   which WebView2 does not open. */
const Pdf = (() => {
  function ascii(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function base64ToBytes(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }

  // Canvas Data URL -> the JPEG byte stream a /DCTDecode image needs.
  function jpegBytesFromDataUrl(url) {
    const comma = String(url || '').indexOf(',');
    if (comma < 0) throw new Error('the canvas did not produce a JPEG');
    return base64ToBytes(url.slice(comma + 1));
  }

  function num(value) {
    return String(Math.round(value * 100) / 100);
  }

  // pages: [{ bytes, width, height }] in pixels; page size in PDF points.
  function fromJpegPages(pages, pageW, pageH) {
    if (!pages || !pages.length) throw new Error('nothing to write');
    const chunks = [];
    let length = 0;
    const put = (data) => { chunks.push(data); length += data.length; };
    const text = (str) => put(ascii(str));

    const offsets = [];
    const objectCount = 2 + pages.length * 3;
    const startObj = (n) => { offsets[n] = length; text(n + ' 0 obj\n'); };

    text('%PDF-1.4\n');
    startObj(1);
    text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    startObj(2);
    const kids = pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
    text('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids + '] >>\nendobj\n');

    pages.forEach((page, i) => {
      const pageObj = 3 + i * 3;
      const contentObj = pageObj + 1;
      const imageObj = pageObj + 2;

      startObj(pageObj);
      text('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(pageW) + ' ' + num(pageH) + '] ' +
        '/Resources << /XObject << /Im0 ' + imageObj + ' 0 R >> /ProcSet [/PDF /ImageC] >> ' +
        '/Contents ' + contentObj + ' 0 R >>\nendobj\n');

      const content = 'q\n' + num(pageW) + ' 0 0 ' + num(pageH) + ' 0 0 cm /Im0 Do\nQ\n';
      startObj(contentObj);
      text('<< /Length ' + content.length + ' >>\nstream\n');
      text(content);
      text('endstream\nendobj\n');

      startObj(imageObj);
      text('<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length +
        ' >>\nstream\n');
      put(page.bytes);
      text('\nendstream\nendobj\n');
    });

    const xref = length;
    text('xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n');
    for (let n = 1; n <= objectCount; n += 1) {
      text(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
    }
    text('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  return { fromJpegPages, jpegBytesFromDataUrl };
})();
