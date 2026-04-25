const KNOWN_SITES = {
  'pbs.twimg.com': 'X (Twitter)',
  'twitter.com': 'X (Twitter)',
  'x.com': 'X (Twitter)',
  'i.pinimg.com': 'Pinterest',
  'pinterest.com': 'Pinterest',
  'assets.are.na': 'Are.na',
  'are.na': 'Are.na',
  'substackcdn.com': 'Substack',
  'substack.com': 'Substack',
  'imgur.com': 'Imgur',
  'i.imgur.com': 'Imgur',
  'instagram.com': 'Instagram',
  'cdninstagram.com': 'Instagram',
  'fbcdn.net': 'Facebook',
  'medium.com': 'Medium',
  'cdn-images-1.medium.com': 'Medium',
  'unsplash.com': 'Unsplash',
  'images.unsplash.com': 'Unsplash',
  'behance.net': 'Behance',
  'mir-s3-cdn-cf.behance.net': 'Behance',
  'dribbble.com': 'Dribbble',
  'cdn.dribbble.com': 'Dribbble',
  'tumblr.com': 'Tumblr',
  'media.tumblr.com': 'Tumblr',
  'reddit.com': 'Reddit',
  'i.redd.it': 'Reddit',
  'preview.redd.it': 'Reddit',
};

export function sourceName(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (KNOWN_SITES[host]) return KNOWN_SITES[host];
    for (const [domain, name] of Object.entries(KNOWN_SITES)) {
      if (host === domain || host.endsWith('.' + domain)) return name;
    }
    return host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
