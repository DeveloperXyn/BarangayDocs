#!/usr/bin/env python3
"""Builds the official-template .docx files in server/docgen/templates/ from the Barangay's ORIGINAL Word file.

Usage:  python3 tools/build_templates.py path/to/INDIGENCY_2026.docx

For each certificate in the barangay's menu it copies the original page (its background images, logo, frame, header,
footer, signature and formatting, untouched) into its own one-page .docx, then replaces only the sample resident's
text with {{PLACEHOLDERS}}. Nothing is redrawn. Pages for certificates that are not in the menu, and the photo of a
resident that sits elsewhere in the original file, are NOT copied. The result is server-side only and is never served.
"""
import sys, zipfile, copy, re, os
from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'w': W, 'r': R}
q = lambda t: '{%s}%s' % (W, t)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'docgen', 'templates')

src = zipfile.ZipFile(sys.argv[1])
parts = {n: src.read(n) for n in src.namelist()}
doc = etree.fromstring(parts['word/document.xml'])
body = doc.find('w:body', NS)

secs, cur = [], []
for k in list(body):
    cur.append(k)
    if k.tag == q('p') and k.find('w:pPr/w:sectPr', NS) is not None:
        secs.append(cur); cur = []
final_sect = body.find('w:sectPr', NS)

def text_of(p): return ''.join(t.text or '' for t in p.iter(q('t')))
def runs_with_text(p): return [r for r in p.iter(q('r')) if r.find('w:t', NS) is not None]
def is_bold(r): return r.find('w:rPr/w:b', NS) is not None

def set_text(p, segs):
    """Replace the paragraph's TEXT runs by segs=[(text, bold)], reusing the original run formatting (font, size, colour)."""
    rs = runs_with_text(p)
    normal = next((r for r in rs if not is_bold(r) and (r.findtext('w:t', namespaces=NS) or '').strip()), rs[0])
    bold = next((r for r in rs if is_bold(r)), None)
    first = rs[0]; parent = first.getparent(); idx = parent.index(first)
    for r in rs: r.getparent().remove(r)
    for i, (txt, b) in enumerate(segs):
        base = bold if (b and bold is not None) else normal
        n = copy.deepcopy(base)
        for c in list(n):
            if c.tag != q('rPr'): n.remove(c)
        if b and bold is None:
            rpr = n.find('w:rPr', NS)
            if rpr is None: rpr = etree.SubElement(n, q('rPr')); n.insert(0, rpr)
            etree.SubElement(rpr, q('b'))
        t = etree.SubElement(n, q('t')); t.text = txt
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        parent.insert(idx + i, n)

def build(name, section_ids, edits):
    kids = []
    for i in section_ids: kids += [copy.deepcopy(k) for k in secs[i]]
    last = kids[-1]
    sp = last.find('w:pPr/w:sectPr', NS)
    sect = copy.deepcopy(sp); sp.getparent().remove(sp)
    paras = [k for k in kids]
    for (pi, segs) in edits:
        set_text(paras[pi], segs)
    nb = etree.Element(body.tag, nsmap=body.nsmap)
    for k in kids: nb.append(k)
    nb.append(sect)
    nd = etree.Element(doc.tag, nsmap=doc.nsmap, attrib=dict(doc.attrib))
    for ch in doc:
        if ch is not body: nd.append(copy.deepcopy(ch))
    nd.append(nb)
    xml = etree.tostring(nd, xml_declaration=True, encoding='UTF-8', standalone=True)
    # keep only the images this page really uses
    used = set(re.findall(rb'r:(?:embed|id|link)="(rId\d+)"', xml))
    rels = etree.fromstring(parts['word/_rels/document.xml.rels'])
    keep = {}
    for rel in list(rels):
        if rel.get('Type', '').endswith('/image') and rel.get('Id').encode() not in used:
            rels.remove(rel)
    media = {rel.get('Target') for rel in rels if rel.get('Type', '').endswith('/image')}
    out = zipfile.ZipFile(os.path.join(OUT, name + '.docx'), 'w', zipfile.ZIP_DEFLATED)
    for n, data in parts.items():
        if n == 'word/document.xml': data = xml
        elif n == 'word/_rels/document.xml.rels': data = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif n.startswith('word/media/') and n[len('word/'):] not in media: continue
        out.writestr(n, data)
    out.close()
    print('built', name, '| images kept:', sorted(m.split('/')[-1] for m in media))

N, B = False, True
# placeholders are plain {{TOKENS}}; the server fills them from the resident's real request (see server/docgen/index.js)
build('certification', [0], [
  (18, [('This is to certify that Mr./Ms. ', N), ('{{NAME}}', B), (' {{NATIONALITY}}, a legal age, is a bonafide resident of {{ADDRESS}}, has been residing in this barangay for {{YEARS}} year/s.', N)]),
  (22, [('This certification is being issued for the purpose of requesting for {{PURPOSE_CHECKS}} assistance from the Municipal Government of Los Baños.', N)]),
  (26, [('Issued on {{DAY_ORD}} day of {{MONTH}} {{YEAR}}.', N)]),
])
build('indigency', [1], [
  (18, [('This is to certify that ', N), ('{{NAME}}', B), (' legal age and a resident of Brgy. Malinta,', N)]),
  (22, [('This certification is being issued upon the request of above mentioned name as a requirement for {{PURPOSE}} Assistance.', N)]),
  (24, [('Given this {{DAY_ORD}} day of {{MONTH}} {{YEAR}}.', N)]),
])
build('indigency-rep', [2], [
  (18, [('This is to certify that ', N), ('{{NAME}}', B), (' legal age and a resident of Brgy. Malinta, Los', N)]),
  (22, [('This certification is being issued upon the request of ', N), ('{{REP_NAME}} ({{REP_AGE}} YEARS OLD) ', B), ('as a requirement for {{PURPOSE}} Assistance.', N)]),
  (24, [('Given this {{DAY_ORD}} day of {{MONTH}} {{YEAR}}.', N)]),
])
build('residency', [7], [
  (17, [('This is to certify that ', N), ('{{NAME}} {{AGE}} years old', B), (' born ', N), ('{{BIRTH_LONG}}', B), (' and a resident of {{ADDRESS}}. This certifies further that the above mentioned name has been', N)]),
  (18, [('residing in this barangay for {{RESIDENCY}}.', N)]),
  (20, [('This certification is being issued upon the request of above mentioned name as a requirement for {{PURPOSE}}.', N)]),
  (22, [('Given this {{DAY_ORD}} day of {{MONTH}}, {{YEAR}}.', N)]),
])
