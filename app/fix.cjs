const fs = require('fs');
const path = 'C:\\Users\\Benjamin\\Downloads\\desktop_cleaner\\app\\src\\components\\Cleaner.svelte';
let content = fs.readFileSync(path, 'utf8');

const regex = /\{:else if phase === "done"\}([\s\S]*?)<\/section>\s*\{\/if\}/;
const replacement = `{:else if phase === "done"}
  <section class="hero done-state">
    <div class="success-icon-container">
      <div class="check-circle">
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
    </div>
    <h1>{formatBytes(freed)} cleaned!</h1>
    <p class="muted">Your PC is lighter and faster. {formatCount(removed)} files removed{skipped ? \`, \${formatCount(skipped)} skipped (in use)\` : ""}.</p>
    {#if results.some((r) => r.moved_to_trash)}
      <p class="note">Files are safely in your {navigator.userAgent.includes("Windows") ? "Recycle Bin" : "Trash"}. Empty it to reclaim the space permanently.</p>
    {/if}
    <button class="primary big" onclick={scan}>Done</button>
  </section>
{/if}`;

content = content.replace(regex, replacement);

const styleAppender = `
<style>
  .done-state {
    animation: fadeIn 0.4s ease-out;
  }
  .success-icon-container {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
  }
  .check-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background-color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), pulseGlow 2s infinite 0.5s;
    box-shadow: 0 0 0 0 rgba(0, 255, 170, 0);
  }
  .check-icon {
    width: 32px;
    height: 32px;
    color: #000;
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: drawCheck 0.4s ease-out 0.2s forwards;
  }
  @keyframes popIn {
    0% { transform: scale(0); }
    100% { transform: scale(1); }
  }
  @keyframes drawCheck {
    to { stroke-dashoffset: 0; }
  }
  @keyframes pulseGlow {
    0% { box-shadow: 0 0 0 0 rgba(0, 255, 170, 0.4); }
    70% { box-shadow: 0 0 0 20px rgba(0, 255, 170, 0); }
    100% { box-shadow: 0 0 0 0 rgba(0, 255, 170, 0); }
  }
</style>
`;

if (!content.includes('.done-state')) {
  if (content.includes('<style>')) {
     content = content.replace('</style>', styleAppender.replace('<style>', '').replace('</style>', '') + '\n</style>');
  } else {
     content += styleAppender;
  }
}

fs.writeFileSync(path, content);
