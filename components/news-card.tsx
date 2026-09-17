import {briefSummary} from '@/lib/football/news.mjs';
import NewsMedia from './news-media';
import LocalTime from './local-time';
import {routeToken} from '@/lib/football/consumer.mjs';
export default function NewsCard({article:a}:{article:Record<string,any>}){return <a className="news-card" href={`/football/news/${routeToken(a.id)}`}><NewsMedia article={a}/><div className="news-card-copy"><span className="intel-news-source">{a.publisher}</span><h3>{a.headline}</h3><p className="news-summary">{briefSummary(a.summary??'')}</p><small><LocalTime fixture={{startsAt:a.publishedAt}}/></small>{a.relatedClubName&&<span className="story-tag">{a.relatedClubName}</span>}<strong className="read-story">Read story →</strong></div></a>;}
