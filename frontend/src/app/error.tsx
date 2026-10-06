'use client';
export default function ErrorPage({reset}:{error:Error;reset:()=>void}){return <main className="page-shell empty-state"><h1>Не удалось загрузить страницу</h1><p>Попробуйте ещё раз.</p><button className="button primary" onClick={reset}>Повторить</button></main>}
