'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export default function Header() {
    const [dark, setDark] = useState(false), [menu, setMenu] = useState(false), [name, setName] = useState('');
    useEffect(() => { try {
        const value = localStorage.getItem('ceniq-theme-v7') === 'dark';
        setDark(value);
        document.documentElement.dataset.theme = value ? 'dark' : 'light';
    }
    catch { } fetch('/api/auth/me').then(r => r.json()).then(d => setName(d.user?.name || (d.user ? 'Konts' : ''))).catch(() => undefined); }, []);
    function toggle() { const value = !dark; setDark(value); document.documentElement.dataset.theme = value ? 'dark' : 'light'; try {
        localStorage.setItem('ceniq-theme-v7', value ? 'dark' : 'light');
    }
    catch { } }
    return <header className="site-header"><a href="#main-content" className="skip-link">Pāriet uz saturu</a><div className="container header-line"><Link className="wordmark" href="/">CENIQ<span>↗</span></Link><nav id="mobile-navigation" className={menu ? 'header-nav open' : 'header-nav'} aria-label="Galvenā navigācija" onClick={() => setMenu(false)}><Link href="/#meklet">Meklēt</Link><Link href="/?mode=assistant#meklet" onClick={() => window.dispatchEvent(new Event('ceniq-ai'))}>AI asistents</Link><Link href="/#kategorijas">Kategorijas</Link><Link href="/#ka-darbojas">Kā tas strādā</Link><Link href="/account">Izlase</Link></nav><div className="header-actions"><button onClick={toggle} aria-label={dark ? 'Ieslēgt gaišo režīmu' : 'Ieslēgt tumšo režīmu'}>{dark ? '☀' : '☾'}</button><Link href={name ? '/account' : '/login'}>{name || 'Ielogoties'}</Link><button className="menu-toggle" aria-expanded={menu} aria-controls="mobile-navigation" aria-label="Atvērt navigāciju" onClick={() => setMenu(!menu)}>☰</button></div></div></header>;
}
