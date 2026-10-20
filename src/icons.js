const iconPaths = {
  image: 'M3 4h18v16H3Z M3 16l6-6 5 5 3-3 4 4 M17 8h.01',
  history: 'M3 5v5h5 M3.8 9a8.3 8.3 0 1 1 1.6 8.4 M12 7v5l3 2',
  search: 'M21 21l-5-5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  plus: 'M12 5v14 M5 12h14', close: 'm6 6 12 12 M6 18 18 6',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  filter: 'M4 6h16 M7 12h10 M10 18h4',
  copy: 'M9 4h10v13H9Z M5 8v13h10',
  paste: 'M9 5H5v16h14V5h-4 M9 3h6v4H9Z M9 12h6 M9 16h4',
  edit: 'm15 4 5 5 M4 20l4.5-1L21 6.5 17.5 3 5 15.5Z',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  link: 'm10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  text: 'M4 5h16 M12 5v15 M8 20h8',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  color: 'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 0-10Z',
  pause: 'M8 5v14 M16 5v14', play: 'm8 4 12 8-12 8Z',
  check: 'm5 12 4 4L19 6', chevron: 'm9 5 7 7-7 7',
  grid: 'M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z',
  expand: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  moon: 'M20 15a8 8 0 0 1-11-11 9 9 0 1 0 11 11',
  keyboard: 'M3 6h18v12H3Z M6 10h1 M10 10h1 M14 10h1 M18 10h.01 M7 14h10',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z M8 12l3 3 5-6',
  undo: 'M8 4 3 9l5 5 M3 9h11a6 6 0 0 1 0 12',
  shelf: 'M4 4h16v16H4Z M8 8h8 M8 12h8 M8 16h5'
};
window.clipIcon = function (name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, String(value));
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', iconPaths[name] || iconPaths.text); svg.append(path); return svg;
};
