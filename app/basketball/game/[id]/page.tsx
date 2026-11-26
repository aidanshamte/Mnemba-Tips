import BasketballGame from '@/components/basketball-game';
export default async function BasketballGamePage({params}: {params: Promise<{id: string}>}) { const {id} = await params; return <BasketballGame id={decodeURIComponent(id)}/>; }
