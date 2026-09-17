import test from 'node:test';
import assert from 'node:assert/strict';
import {newsMedia,newsImageCandidates} from '../../lib/football/media-policy.mjs';
import {parseFeed} from '../../lib/football/news.mjs';
const url='https://www.bbc.co.uk/sport/a';
const media=(image,width,height)=>({url:image,width,height,articleUrl:url,kind:'rss',usageBasis:'Publisher feed',attribution:'BBC'});
test('news selects the largest supplied image and preserves signed URLs',()=>{
 const small=media('https://i.guim.co.uk/a.jpg?width=140&s=signature',140,80);
 const large=media('https://i.guim.co.uk/a.jpg?width=2000&s=other',2000,1125);
 assert.equal(newsMedia({url,images:[small,large]}).url,large.url);
 assert.equal(newsMedia({url,images:[small,large]},[large.url]).url,small.url);
});
test('BBC thumbnails request 1920px and recover to the exact original on failure',()=>{
 const original=media('https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/example.jpg',240,135);
 const a={url,images:[original]},hd=newsMedia(a).url;
 assert.equal(hd,'https://ichef.bbci.co.uk/ace/standard/1920/cpsprodpb/example.jpg');
 assert.equal(newsMedia(a,[hd]).url,original.url);
 assert.equal(newsMedia(a,[hd,original.url]).type,'placeholder');
 assert.equal(newsImageCandidates([media('https://ichef.bbci.co.uk/news/standard/3840/a.jpg',3840,2160)])[0].url,'https://ichef.bbci.co.uk/news/standard/3840/a.jpg');
 assert.deepEqual(newsImageCandidates([media('https://evil.test/a.jpg',4096,2160)]),[]);
});
test('RSS retains dimensions regardless of attribute order',()=>{
 const [a]=parseFeed(`<rss><item><title>Football</title><link>${url}</link><pubDate>2026-09-12</pubDate><media:thumbnail width="240" url="https://ichef.bbci.co.uk/a.jpg" height="135"/><media:content url="https://ichef.bbci.co.uk/b.jpg" height="1080" width="1920"/></item></rss>`,{publisher:'BBC',hosts:['bbc.co.uk'],url:'https://feeds.bbci.co.uk/rss'},Date.parse('2026-09-13'));
 assert.equal(a.images[0].width,240);assert.equal(a.images[1].height,1080);
 assert.equal(newsMedia(a).url,a.images[1].url);
});
