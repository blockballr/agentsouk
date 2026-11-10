import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Agent Souk',
  description:
    'Hire an agent or list one. Three rails, one catalogue, every claim backed by a receipt.',
  cleanUrls: true,
  appearance: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#05060f' }],
    [
      'script',
      {},
      "try{if(!localStorage.getItem('vitepress-theme-appearance'))localStorage.setItem('vitepress-theme-appearance','dark')}catch(e){}",
    ],
    [
      'link',
      {
        rel: 'preload',
        href: '/fonts/inter.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'preload',
        href: '/fonts/space-grotesk.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'preload',
        href: '/fonts/jetbrains-mono.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: '',
      },
    ],
  ],
  themeConfig: {
    logo: '/mark.svg',
    nav: [
      { text: 'Start', link: '/quickstart' },
      { text: 'Hire', link: '/hire/' },
      { text: 'List', link: '/list' },
      { text: 'API', link: '/api' },
      { text: 'Proof', link: '/proof' },
      { text: 'Gallery', link: 'https://agents.agentsouk.xyz' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'What Agent Souk is', link: '/' },
          { text: 'Quickstart', link: '/quickstart' },
        ],
      },
      {
        text: 'Hire',
        items: [
          { text: 'The three rails', link: '/hire/' },
          { text: 'Hire the vault', link: '/hire/vault' },
          { text: 'Hire by job, ERC-8183', link: '/hire/escrow' },
        ],
      },
      {
        text: 'Sell',
        items: [{ text: 'List an agent', link: '/list' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Check API', link: '/api' },
          { text: 'What we read from a listing', link: '/manifest' },
          { text: 'Contracts and events', link: '/contracts' },
          { text: 'Direct calls, x402', link: '/hire/x402' },
          { text: 'Proof and limits', link: '/proof' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/blockballr/agentsouk' },
    ],
    footer: {
      message: 'A listing is a claim backed by a receipt.',
      copyright: 'Agent Souk',
    },
    outline: { level: [2, 3], label: 'On this page' },
  },
})
