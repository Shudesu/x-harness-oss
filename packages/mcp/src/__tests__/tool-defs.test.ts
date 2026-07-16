import { describe, it, expect } from 'vitest';
import { scrapeToolDefs } from '../tools/scrape.js';
import { growthToolDefs } from '../tools/growth.js';

describe('scrapeToolDefs', () => {
  it('registers all four scrape tools with required fields', () => {
    const names = scrapeToolDefs.map((t) => t.name);
    expect(names).toEqual(['scrape_user_posts', 'scrape_search', 'scrape_post', 'scrape_user']);
    for (const def of scrapeToolDefs) {
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('scrape tools advertise being free (no X API billing)', () => {
    for (const def of scrapeToolDefs) {
      expect(def.description).toMatch(/無料/);
    }
  });
});

describe('growthToolDefs', () => {
  it('registers all five growth tools', () => {
    expect(growthToolDefs.map((t) => t.name)).toEqual([
      'add_growth_source',
      'list_growth_sources',
      'save_growth_article',
      'list_growth_articles',
      'add_growth_draft',
    ]);
  });

  it('add_growth_draft warns about the JST scheduledAt format', () => {
    const def = growthToolDefs.find((t) => t.name === 'add_growth_draft')!;
    expect(def.description).toContain('YYYY-MM-DDTHH:MM:SS+09:00');
  });
});
