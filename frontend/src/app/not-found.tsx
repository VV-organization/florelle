import Link from 'next/link';
export default function NotFound(){return <main className="page-shell empty-state"><span className="text-accent">Кажется, мы разминулись</span><h1>Эта страница не найдена</h1><Link className="button primary" href="/catalog">Вернуться к цветам ↗</Link></main>}
