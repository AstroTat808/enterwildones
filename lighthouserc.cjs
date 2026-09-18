module.exports = {
  ci: {
    collect: {
      startServerCommand: 'python3 -m http.server 4173 --directory site',
      startServerReadyPattern: 'Serving HTTP',
      startServerReadyTimeout: 15000,
      url: [
        'http://127.0.0.1:4173/index.html',
        'http://127.0.0.1:4173/find-your-realm.html',
        'http://127.0.0.1:4173/events/aureva.html'
      ],
      numberOfRuns: 2,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless=new',
        onlyCategories: ['performance','accessibility','best-practices','seo']
      }
    },
    assert: {
      assertions: {
        'categories:performance': ['error', {minScore: 0.80}],
        'categories:accessibility': ['error', {minScore: 0.95}],
        'categories:best-practices': ['error', {minScore: 0.95}],
        'categories:seo': ['error', {minScore: 0.90}],
        'first-contentful-paint': ['error', {maxNumericValue: 2500}],
        'largest-contentful-paint': ['error', {maxNumericValue: 4000}],
        'cumulative-layout-shift': ['error', {maxNumericValue: 0.10}],
        'total-blocking-time': ['error', {maxNumericValue: 350}],
        'speed-index': ['error', {maxNumericValue: 4500}]
      }
    },
    upload: {
      target: 'filesystem',
      outputDir: 'lighthouse-results'
    }
  }
};
