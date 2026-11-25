'use client';
// Responsive Mnemba Tips navigation (Figma: Desktop navigation, Tablet top bar,
// Mobile top bar, Mobile bottom navigation, Searchable mobile sheet, Timezone control).
// ≥1280px: fixed 264px rail · 768–1279px: top bar + menu sheet · <768px: top bar + bottom nav.
import {useEffect,useRef,useState,type MouseEvent} from 'react';
import {Home,CalendarDays,Trophy,Users,Newspaper,History,Bookmark,Search,Menu,X,Globe,ChartColumn,Layers3,Image as ImageIcon,Volleyball,Radio} from 'lucide-react';
import {TimePreference} from './local-time';
import BrandLogo from './brand-logo';

type Item={key:string;label:string;href:string;tab?:string;Icon:typeof Home};
// Workspace tabs keep their existing ?tab= deep links.
const PRIMARY:Item[]=[
 {key:'home',label:'Home',href:'/football',tab:'Predictions',Icon:Home},
 {key:'fixtures',label:'Fixtures',href:'/football?tab=Fixtures',tab:'Fixtures',Icon:CalendarDays},
 {key:'live',label:'Live scores',href:'/football?tab=Live',tab:'Live',Icon:Radio},
 {key:'leagues',label:'Leagues',href:'/football?tab=Leagues',tab:'Leagues',Icon:Trophy},
 {key:'search',label:'Teams and players',href:'/football/search',Icon:Users},
 {key:'news',label:'News',href:'/football?tab=News',tab:'News',Icon:Newspaper},
 {key:'history',label:'Prediction history',href:'/football/predictions',Icon:History},
 {key:'picks',label:'Saved picks',href:'/football/shortlists',Icon:Bookmark},
];
const SECONDARY:Item[]=[
 {key:'markets',label:'Markets',href:'/football/markets',Icon:ChartColumn},
 {key:'coverage',label:'Coverage',href:'/football/coverage',Icon:Layers3},
 {key:'credits',label:'Visual credits',href:'/football/visual-credits',Icon:ImageIcon},
 {key:'basketball',label:'Basketball',href:'/basketball',Icon:Volleyball},
];
const BOTTOM=['home','fixtures','live','search','news'];
export const TAB_KEY:Record<string,string>={Predictions:'home',Fixtures:'fixtures',Live:'live',Leagues:'leagues','Teams & Players':'search',News:'news'};

/** Derive the active item from the URL (after mount, so server and first client render match). */
function activeFromLocation():string{
 const {pathname,search}=window.location,tab=new URLSearchParams(search).get('tab');
 if(pathname==='/'||pathname==='/football')return tab?TAB_KEY[tab]??'home':'home';
 if(pathname.startsWith('/football/match'))return 'fixtures';
 if(pathname.startsWith('/football/competition'))return 'leagues';
 if(/^\/football\/(search|team|player|players)/.test(pathname))return 'search';
 if(pathname.startsWith('/football/news'))return 'news';
 if(pathname.startsWith('/football/predictions'))return 'history';
 if(pathname.startsWith('/football/shortlists'))return 'picks';
 return [...SECONDARY].find(i=>pathname.startsWith(i.href))?.key??'';
}

function Brand({tagline}:{tagline?:boolean}){return <a className="mt-brand" href="/football" aria-label="Mnemba Tips home"><span className="mt-brand-plate"><BrandLogo sizes="(min-width: 1280px) 192px, (min-width: 768px) 136px, 120px" priority/></span>{tagline&&<small className="mt-brand-tagline">The game, a little clearer</small>}</a>;}

export default function SiteNav({active,onTab}:{active?:string;onTab?:(tab:string)=>void}){
 // `active` (from the workspace) wins; other pages read the URL after mount.
 const [located,setLocated]=useState(''),current=active??located;
 const sheet=useRef<HTMLDialogElement>(null),zone=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(active!==undefined)return;const sync=()=>setLocated(activeFromLocation());const t=setTimeout(sync,0);window.addEventListener('popstate',sync);return()=>{clearTimeout(t);window.removeEventListener('popstate',sync);};},[active]);
 const go=(item:Item)=>(e:MouseEvent<HTMLAnchorElement>)=>{
  sheet.current?.close();
  if(onTab&&item.tab&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&e.button===0){e.preventDefault();onTab(item.tab);}
 };
 const link=(item:Item,cls:string)=><a key={item.key} className={cls} href={item.href} aria-current={current===item.key?'page':undefined} onClick={go(item)}><item.Icon aria-hidden="true" size={20} strokeWidth={1.75}/><span>{item.label}</span></a>;
 const open=(d:HTMLDialogElement|null)=>{if(d&&!d.open)d.showModal();};
 const closeOnBackdrop=(e:MouseEvent<HTMLDialogElement>)=>{if(e.target===e.currentTarget)e.currentTarget.close();};
 return <>
  <a className="mt-skip" href="#mt-main">Skip to main content</a>
  <nav className="mt-rail" aria-label="Main navigation">
   <Brand tagline/>
   <div className="mt-rail-links">{PRIMARY.map(i=>link(i,'mt-nav-item'))}</div>
   <div className="mt-rail-secondary" aria-label="More">{SECONDARY.map(i=>link(i,'mt-nav-item mt-nav-item-small'))}</div>
   <div className="mt-rail-zone"><span className="mt-rail-zone-label"><Globe aria-hidden="true" size={16}/>Times in your timezone</span><TimePreference/></div>
  </nav>
  <header className="mt-topbar">
   <Brand/>
   <span className="mt-topbar-space"/>
   <a className="mt-icon-btn mt-topbar-search" href="/football/search" aria-label="Search teams, players and competitions"><Search aria-hidden="true" size={20}/></a>
   <button type="button" className="mt-icon-btn" aria-label="Timezone" onClick={()=>open(zone.current)}><Globe aria-hidden="true" size={20}/></button>
   <button type="button" className="mt-icon-btn mt-topbar-menu" aria-label="Open menu" aria-haspopup="dialog" onClick={()=>open(sheet.current)}><Menu aria-hidden="true" size={22}/></button>
  </header>
  <nav className="mt-bottom-nav" aria-label="Quick navigation">
   {PRIMARY.filter(i=>BOTTOM.includes(i.key)).map(i=>link(i.key==='search'?{...i,label:'Search'}:i.key==='live'?{...i,label:'Live'}:i,'mt-tab'))}
   <button type="button" className="mt-tab" aria-haspopup="dialog" onClick={()=>open(sheet.current)}><Menu aria-hidden="true" size={20} strokeWidth={1.75}/><span>More</span></button>
  </nav>
  <dialog ref={sheet} className="mt-sheet" aria-label="Menu" onClick={closeOnBackdrop}>
   <div className="mt-sheet-head"><strong>Menu</strong><button type="button" className="mt-icon-btn" aria-label="Close menu" onClick={()=>sheet.current?.close()}><X aria-hidden="true" size={22}/></button></div>
   <div className="mt-sheet-links">{PRIMARY.map(i=>link(i,'mt-sheet-item'))}</div>
   <div className="mt-sheet-links mt-sheet-secondary">{SECONDARY.map(i=>link(i,'mt-sheet-item'))}</div>
   <div className="mt-sheet-zone"><span className="mt-label">Timezone</span><TimePreference/></div>
  </dialog>
  <dialog ref={zone} className="mt-sheet" aria-label="Timezone" onClick={closeOnBackdrop}>
   <div className="mt-sheet-head"><strong>Times in your timezone</strong><button type="button" className="mt-icon-btn" aria-label="Close timezone" onClick={()=>zone.current?.close()}><X aria-hidden="true" size={22}/></button></div>
   <p className="mt-supporting">Every kickoff is converted to the timezone you choose. Dates without a confirmed kickoff time stay marked as unconfirmed.</p>
   <TimePreference/>
  </dialog>
  <span id="mt-main" className="mt-main-anchor" tabIndex={-1}/>
 </>;
}
