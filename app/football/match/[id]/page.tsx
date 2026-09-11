import MatchCenter from '@/components/match-center';
export default async function MatchPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <MatchCenter id={id}/>;}
