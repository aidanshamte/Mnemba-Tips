import FootballEntity from '@/components/football-entity';
export default async function TeamPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <FootballEntity id={id}/>;}
