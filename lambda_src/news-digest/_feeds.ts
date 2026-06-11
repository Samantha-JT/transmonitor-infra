export interface ServerFeed { name: string; url: string; lang?: string; scanAllWithBedrock?: boolean; }
const gn = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const gnGB = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
export const VARIANT_FEEDS: Record<string, Record<string, ServerFeed[]>> = {
  trans: {
    legal: [
      // DISABLED 2026-06-07: persistent 404/403 in Lambda logs: { name: 'Trans Legislation Tracker', url: 'https://translegislation.com/rss.xml' },
      { name: 'Law Dork', url: 'https://www.lawdork.com/feed' },
      { name: 'Good Law Project', url: 'https://goodlawproject.org/feed/' },
      { name: 'UK Trans Law', url: gnGB('("GRC" OR "Gender Recognition Act" OR "Cass Review" OR "Equality Act") UK when:3d') },
      { name: 'US Trans Legislation', url: gn('("gender-affirming care ban" OR "trans bill" OR "bathroom bill" OR "drag ban") when:3d') },
      { name: 'EU Gender Recognition', url: gn('("gender self-determination" OR "Ley Trans" OR "Selbstbestimmungsgesetz") when:7d') },
    ],
    healthcare: [
      { name: 'Gender Analysis', url: 'https://genderanalysis.net/feed/' },
      { name: 'Cass Review Coverage', url: gn('("Cass Review" OR "Tavistock clinic") when:7d') },
      { name: 'Trans Healthcare Access', url: gn('("transgender" OR "trans rights") ("gender-affirming care" OR "puberty blockers" OR "hormone therapy") when:3d') },
      { name: 'Puberty Blocker Rulings', url: gn('"puberty blockers" (court OR ruling OR ban) when:7d') },
    ],
    community: [
      { name: 'PinkNews', url: 'https://www.thepinknews.com/feed/' },
    ],
    international: [
      { name: 'LatAm Trans Rights', url: gn('("Ley de Identidad de Genero" OR "transgender rights" OR "travesti") when:7d') },
      { name: 'Asia-Pacific Trans News', url: gn('("transgender" OR "hijra") (Thailand OR Japan OR Korea OR India) when:7d') },
    ],
    safety: [
      { name: 'Trans Murder Monitoring', url: gn('site:transrespect.org when:30d') },
      { name: 'TDoR / TDoV Coverage', url: gn('("Trans Day of Remembrance" OR "TDoR" OR "Trans Day of Visibility") when:30d') },
      { name: 'Trans Violence News', url: gn('("transgender" OR "trans woman" OR "trans man") ("hate crime" OR "attacked" OR "murdered") when:3d') },
      { name: 'UK Trans Safety', url: gnGB('("transgender" OR "trans") ("hate crime" OR "attack" OR "violence") UK when:7d') },
    ],
    "uk-press": [
      // Direct RSS feeds for media-bias sources. These reduce reliance on Google News
      // backfill and give unscored registry sources real articles to ingest/score.
      { name: 'Attitude', scanAllWithBedrock: true, url: 'https://www.attitude.co.uk/feed/' },
      { name: 'DIVA Magazine', scanAllWithBedrock: true, url: 'https://diva-magazine.com/feed/' },
      { name: 'Vice UK', scanAllWithBedrock: true, url: 'https://www.vice.com/en/rss' },
      { name: 'BBC News', url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:bbc.co.uk when:3d') },
      { name: 'The Guardian', url: gnGB('(transgender OR "trans rights") site:theguardian.com when:3d') },
      { name: 'The Independent', url: gnGB('(transgender OR "trans rights") site:independent.co.uk when:3d') },
      { name: 'Sky News', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:news.sky.com when:30d') },
      { name: 'Channel 4 News', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:channel4.com when:30d') },
      { name: 'The Times', url: gnGB('(transgender OR "trans rights" OR "Cass Review" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:thetimes.co.uk when:30d') },
      { name: 'The Telegraph', url: gnGB('(transgender OR "trans rights") site:telegraph.co.uk when:30d') },
      { name: 'The Sun', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:thesun.co.uk when:3d') },
      { name: 'GB News', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:gbnews.com when:3d') },
      { name: 'Daily Mirror', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:mirror.co.uk when:3d') },
      { name: 'The Spectator', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:spectator.co.uk when:30d') },
      { name: 'HuffPost UK', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:huffingtonpost.co.uk when:30d') },
      { name: 'TalkTV', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:talk.tv when:30d') },
      { name: 'ITV News', url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:itv.com when:3d') },
      { name: 'Metro', url: gnGB('(transgender OR "trans rights") site:metro.co.uk when:3d') },
    ],
    wins: [
      { name: 'Trans Wins', url: gnGB('(transgender OR "trans rights") (wins OR victory OR "first trans" OR milestone OR landmark) when:7d') },
      { name: 'Trans Legal Wins', url: gn('(transgender OR "trans rights") (court OR judge) (blocks OR overturns) when:7d') },
    ],
    mainstream: [
      { name: 'Washington Post Trans', url: gn('site:washingtonpost.com ("transgender" OR "gender-affirming care ban") when:7d') },
      { name: 'NYT Trans Coverage', url: gn('site:nytimes.com ("transgender" OR "gender-affirming care ban") when:7d') },
    ],
  },
};
export const INTEL_SOURCES: ServerFeed[] = [];
