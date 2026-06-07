const fs=require('fs');
let h=fs.readFileSync('C:/Users/COMPUTER CITY/Music/Symapse/apps/web/dashboard.html','utf-8');

h=h.replace('<div class="font-mono text-28">$12.81</div>','<div class="font-mono text-28" id="eff-cost">—</div>');
h=h.replace('<div class="font-mono text-28">42</div>','<div class="font-mono text-28" id="eff-sessions">—</div>');
h=h.replace('<div class="font-mono text-28">68%</div>','<div class="font-mono text-28" id="eff-drop">—%</div>');
h=h.replace('symapse_search</span></div><span class="font-mono text-12 text-muted">182</span>','symapse_search</span></div><span class="font-mono text-12 text-muted" id="eff-tool1-val">—</span>');
h=h.replace('symapse_where</span></div><span class="font-mono text-12 text-muted">94</span>','symapse_where</span></div><span class="font-mono text-12 text-muted" id="eff-tool2-val">—</span>');
h=h.replace('symapse_impact</span></div><span class="font-mono text-12 text-muted">41</span>','symapse_impact</span></div><span class="font-mono text-12 text-muted" id="eff-tool3-val">—</span>');
h=h.replace('<p class="text-12 font-mono text-muted uppercase mb-2">Token Delta</p>','<p class="text-12 font-mono text-muted uppercase mb-2">Total Calls</p>');
h=h.replace(/const mockSessions[\s\S]*?loadSession\(id, element\)/,'let allSessions=[];function loadSession(id, element)');

// Replace the entire script with real API logic
const scriptIdx = h.lastIndexOf('<script>');
const endIdx = h.lastIndexOf('</script>');
const newScript = `
    <script>
        let repos=[], currentRepo='', allSessions=[];

        async function loadWorkspaces(){
          try{const r=await fetch('/workspaces');const d=await r.json();repos=d.workspaces||[];
          const s=document.getElementById('repo-selector');
          s.innerHTML=repos.length?repos.map(w=>`<option value="${w.path}">${w.path.split('/').pop()||w.path.substring(w.path.lastIndexOf('\\\\')+1)}</option>`).join(''):'<option>No repos found</option>';
          if(repos.length){currentRepo=repos[0].path;refreshTab()}}catch(e){}
        }

        document.addEventListener('DOMContentLoaded',()=>{
          requestAnimationFrame(()=>document.getElementById('app-frame').classList.add('loaded'));
          loadWorkspaces();
        });

        function switchTab(targetId, btnEl, name){
          document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('nav-active'));
          btnEl.classList.add('nav-active');
          document.getElementById('breadcrumb-current').innerText=name;
          const cur=document.querySelector('.tab-pane.active');
          const next=document.getElementById(targetId);
          if(cur===next)return;
          cur.classList.remove('visible');
          setTimeout(()=>{cur.classList.remove('active');next.classList.add('active');void next.offsetWidth;next.classList.add('visible');refreshTab();},250);
        }

        async function refreshTab(){
          if(!currentRepo)return;
          const tab=document.querySelector('.tab-pane.active')?.id||'tab-efficiency';
          const r='&repo='+encodeURIComponent(currentRepo);

          if(tab==='tab-efficiency'){try{const d=await(await fetch('/dashboard/efficiency'+r)).json();
            const el=(id,v)=>document.getElementById(id)&&(document.getElementById(id).textContent=v);
            el('eff-tokens',(d.totalTokens/1000).toFixed(0)+'k');
            el('eff-cost','$'+d.costSaved);
            el('eff-sessions',d.sessionCount);
            el('eff-drop',Math.round(d.savedTokens/Math.max(1,d.totalTokens)*100)+'%');
            if(d.toolCounts[0])el('eff-tool1-val',d.toolCounts[0][1]);
            if(d.toolCounts[1])el('eff-tool2-val',d.toolCounts[1][1]);
            if(d.toolCounts[2])el('eff-tool3-val',d.toolCounts[2][1]);
          }catch(e){}}

          if(tab==='tab-activity'){try{const d=await(await fetch('/dashboard/sessions'+r)).json();
            allSessions=d.sessions||[];
            const hist=document.getElementById('sess-history');
            if(hist){
              let h='<p class=\"text-11 uppercase font-mono text-muted mb-2\" style=\"padding-left: 0.25rem;\">Session Audit Trail</p>';
              allSessions.forEach((s,i)=>{h+=`<div class=\"history-card${i===0?' active':''}\" onclick=\"loadSession('${s.sessionId}',this)\"><div class=\"flex-between mb-2\"><span class=\"font-mono text-12 font-medium\">${s.sessionId.substring(0,22)}</span></div><div class=\"flex-center gap-2\"><span class=\"badge text-11 font-mono\">${s.toolCalls} calls</span></div></div>`});
              hist.innerHTML=h||'<p class=\"text-12 text-muted\">No sessions yet</p>';
              if(allSessions[0])loadSessionData(allSessions[0]);
            }}catch(e){}}

          if(tab==='tab-memory'){try{const d=await(await fetch('/dashboard/memory'+r)).json();
            const body=document.getElementById('registry-body');
            if(body&&d.total){let h='';for(const[t,entries]of Object.entries(d.byType)){for(const e of entries.slice(0,15))h+=`<tr data-type=\"${t}\"><td><span class=\"badge font-mono text-11\">${t}</span></td><td><strong class=\"font-mono\">${e.key}</strong></td><td class=\"text-muted\">${e.value}</td><td><span class=\"font-mono text-12 repo-name-display\">${currentRepo.split('/').pop()}</span></td><td class=\"text-muted font-mono text-11\">${(e.timestamp||'').substring(0,19)}</td></tr>`}
            body.innerHTML=h||'<tr><td colspan=\"5\" class=\"text-muted\" style=\"text-align:center;padding:2rem;\">No knowledge entries yet</td></tr>';}}catch(e){}}

          if(tab==='tab-settings'){try{const s=await(await fetch('/status')).json();
            document.querySelectorAll('.repo-name-display').forEach(e=>e.textContent=(s.repoRoot||'Unknown').split('/').pop()||s.repoRoot||'Unknown');
          }catch(e){}}
        }

        function handleRepoChange(val){currentRepo=val;switchTabContent();}
        async function switchTabContent(){document.getElementById('db-loader').classList.add('active');document.querySelectorAll('.repo-name-display').forEach(e=>e.textContent=currentRepo.split('/').pop());await refreshTab();document.getElementById('db-loader').classList.remove('active')}

        function loadSessionData(s){document.getElementById('inspect-id').textContent=s.sessionId.substring(0,22);document.getElementById('inspect-goal').textContent=s.sessionId.substring(0,30)+'...';document.getElementById('inspect-delta').textContent=s.toolCalls+' calls';document.getElementById('inspect-used').textContent=s.actions?.length||0;document.getElementById('inspect-outcome').textContent=s.actions?.length?s.actions.length+' actions':'No actions';let trace='';for(const a of(s.actions||[]).slice(0,8)){trace+=`<div class=\"trace-step\"><div class=\"trace-icon\"><div class=\"dot\"></div></div><div><div class=\"flex-center gap-3 mb-2\"><span class=\"font-mono text-13\">${a.tool}</span></div><p class=\"text-12 text-muted\">${a.target} · ${(a.time||'').substring(0,19)}</p></div></div>`}document.getElementById('inspect-trace').innerHTML=trace||'<p class=\"text-12 text-muted\">No trace data</p>';setTimeout(()=>{const p=document.getElementById('session-inspect-pane');if(p){p.style.opacity='1';p.style.transition='opacity 0.2s ease'}},50)}function loadSession(id,el){document.querySelectorAll('.history-card').forEach(c=>c.classList.remove('active'));el.classList.add('active');const s=allSessions.find(s=>s.sessionId===id);if(s)loadSessionData(s)}

        async function runAnalysis(){const btn=document.getElementById('run-analysis-btn');btn.innerText='Analyzing...';btn.style.opacity='.7';const r='&repo='+encodeURIComponent(currentRepo);try{const d=await(await fetch('/dashboard/findings'+r)).json();document.getElementById('findings-empty').style.display='none';const res=document.getElementById('findings-results');res.style.display='grid';let h='';if(d.findings.length){h+='<div class=\"premium-card\" style=\"grid-column:span 2;\"><h3 class=\"text-12 text-muted uppercase font-medium mb-4\">Findings</h3>';for(const f of d.findings)h+=`<div class=\"flex-between badge mb-2\"><span class=\"font-mono text-13\">${f.key}</span><span class=\"text-12 text-muted\">${f.value}</span></div>`;h+='</div>'}if(d.patterns.length){h+='<div class=\"premium-card\" style=\"grid-column:span 2;\"><h3 class=\"text-12 text-muted uppercase font-medium mb-4\">Workflow Patterns</h3>';for(const p of d.patterns)h+=`<div class=\"flex-between badge mb-2\"><span class=\"font-mono text-13\">${p.key}</span><span class=\"text-12 text-muted\">${p.value}</span></div>`;h+='</div>'}res.innerHTML=h||'<div class=\"placeholder\" style=\"text-align:center;padding:2rem;grid-column:span 2;\"><p class=\"text-13 text-muted\">No findings yet. Keep using Symapse.</p></div>'}catch(e){}finally{btn.innerText='Run Analysis';btn.style.opacity='1'}}

        function filterRegistry(type,btn){document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('#registry-body tr').forEach(r=>r.style.display=(type==='all'||r.dataset.type===type)?'':'none')}
        function searchRegistry(input){const q=input.value.toLowerCase();document.querySelectorAll('#registry-body tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none')}
    </script>`;

h = h.substring(0, scriptIdx) + newScript;
fs.writeFileSync('C:/Users/COMPUTER CITY/Music/Symapse/apps/web/dashboard.html', h);
console.log('done');
