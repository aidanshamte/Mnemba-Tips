import CompetitionCenter from '@/components/competition-center';
export default async function CompetitionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <CompetitionCenter id={id}/>;}
