import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,existsSync,mkdirSync,cpSync,readdirSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const desktop=resolve(root,process.env.MARKPROTO_DESKTOP_DIR || '../apps/desktop');
const app=resolve(root,process.env.MARKPROTO_APP_DIR || '../packages/client');
const repository='mars-log/mark-proto-release', desktopRepo='mars-log/mark-proto-desktop';
// Installed versions through 0.2.6 allow only this legacy download path; GitHub redirects it.
const downloadRepository='isunz/mark-proto-release';
function run(command,args,cwd=root){return execFileSync(command,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();}
function visible(command,args,cwd=root){execFileSync(command,args,{cwd,stdio:'inherit'});}
function config(){return JSON.parse(readFileSync(join(desktop,'src-tauri/tauri.conf.json')));}
function cleanPushed(path){if(run('git',['status','--porcelain'],path))throw Error('Commit changes first: '+path);const head=run('git',['rev-parse','HEAD'],path);run('git',['fetch','origin'],path);if(run('git',['rev-parse','@{upstream}'],path)!==head)throw Error('Push source first: '+path);return head;}
function pinned(){const revision=readFileSync(join(desktop,'app-source.properties'),'utf8').match(/^revision=([a-f0-9]{40})$/m)?.[1];if(!revision)throw Error('Invalid app pin');return revision;}
function artifactRoot(){return join(root,'.artifacts',config().version);}
async function build(which='both'){
  if(!['both','local','remote'].includes(which))throw Error('Use build [local|remote]');
  if(!['darwin','win32'].includes(process.platform))throw Error('Run on macOS or Windows');
  const appCommit=cleanPushed(app),desktopCommit=cleanPushed(desktop);if(appCommit!==pinned())throw Error('Update app-source.properties first');
  const remote=process.platform==='darwin'?'windows':'macos', id=randomUUID();let runId;
  if(which!=='local'){
    const branch=run('git',['branch','--show-current'],desktop);if(!branch)throw Error('A pushed branch is required');
    run('gh',['workflow','run','desktop-build.yml','--repo',desktopRepo,'--ref',branch,'-f','platform='+remote,'-f','request_id='+id]);
    for(let n=0;n<30;n++){
      await new Promise(r=>setTimeout(r,2000));
      const runs=JSON.parse(run('gh',['run','list','--repo',desktopRepo,'--workflow','desktop-build.yml','--limit','50','--json','databaseId,displayTitle,headSha']));
      const match=runs.find(r=>r.displayTitle.includes(id));if(match){if(match.headSha!==desktopCommit)throw Error('CI source changed');runId=match.databaseId;break;}
    }
    if(!runId)throw Error('Could not locate requested CI run');
    console.log('CI: https://github.com/'+desktopRepo+'/actions/runs/'+runId);
  }
  if(which!=='remote'){
    visible('bash',['-lc',process.platform==='darwin'?'npm run desktop:build && bash scripts/package-macos.sh':'bash scripts/build-windows.sh --installer'],desktop);
    visible('node',['scripts/collect-release.js'],desktop);
    const directory=join(artifactRoot(),process.platform==='darwin'?'macos':'windows');mkdirSync(directory,{recursive:true});cpSync(join(desktop,'release-output'),directory,{recursive:true});
  }
  if(runId){visible('gh',['run','watch',String(runId),'--repo',desktopRepo,'--exit-status','--interval','30']);const directory=join(artifactRoot(),remote);mkdirSync(directory,{recursive:true});visible('gh',['run','download',String(runId),'--repo',desktopRepo,'--name','desktop-'+remote,'--dir',directory]);}
  console.log('Build outputs: '+artifactRoot());
}
function publish(stageOnly=false){
  mkdirSync(join(root,'channels'),{recursive:true});
  if(!stageOnly && JSON.parse(run('gh',['repo','view',repository,'--json','isPrivate'])).isPrivate)throw Error('Public artifact distribution requires approved repository visibility');
  cleanPushed(root);
  const key=process.env.MARKPROTO_SIGNING_KEY || join(homedir(),'.config/markproto-release/updater.key');if(!existsSync(key))throw Error('Update signing key is missing');
  const base=artifactRoot();if(!existsSync(base))throw Error('Build first');
  for(const folder of readdirSync(base)){
    const dir=join(base,folder),metadataFiles=readdirSync(dir).filter(f=>/^(darwin|windows)-(aarch64|x86_64)\.json$/.test(f));
    for(const file of metadataFiles){
      const meta=JSON.parse(readFileSync(join(dir,file)));if(meta.platform+'.json'!==file)throw Error('Artifact platform mismatch');if(meta.version!==config().version || meta.appCommit!==pinned() || !/^[a-f0-9]{40}$/.test(meta.desktopCommit))throw Error('Source/version mismatch');
      run('git',['merge-base','--is-ancestor',meta.desktopCommit,'origin/main'],desktop);
      const sourceConfig=JSON.parse(run('git',['show',meta.desktopCommit+':src-tauri/tauri.conf.json'],desktop));
      const sourcePin=run('git',['show',meta.desktopCommit+':app-source.properties'],desktop).match(/^revision=([a-f0-9]{40})$/m)?.[1];
      if(sourceConfig.version!==meta.version || sourcePin!==meta.appCommit || sourceConfig.plugins.updater.pubkey!==config().plugins.updater.pubkey)throw Error('Artifact source configuration differs');
      const extension=meta.platform.startsWith('darwin-')?'.dmg':'.exe';if(meta.file!=='MARKPROTO-'+meta.version+'-'+meta.platform+extension)throw Error('Invalid artifact name');
      const artifact=join(dir,meta.file);if(createHash('sha256').update(readFileSync(artifact)).digest('hex')!==meta.sha256)throw Error('Artifact checksum mismatch');
      const channel=join(root,'channels',file);if(existsSync(channel)){const old=JSON.parse(readFileSync(channel));if(old.version===meta.version){console.log('Already published: '+meta.platform);continue;}const a=old.version.split('.').map(Number),b=meta.version.split('.').map(Number);if(a[0]>b[0] || a[0]===b[0]&&(a[1]>b[1] || a[1]===b[1]&&a[2]>=b[2]))throw Error('Version must increase');}
      run(process.execPath,[join(desktop,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','-f',key,'-p',process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '',artifact],desktop);
      visible('cargo',['run','--release','--locked','--example','verify-release','--',artifact,artifact+'.sig'],desktop);
      const tag='v'+meta.version+'-'+meta.platform;
      const checksum=join(dir,'SHA256SUMS');writeFileSync(checksum,meta.sha256+'  '+meta.file+'\n');
      const notes=join(dir,'release-notes.md');writeFileSync(notes,existsSync(join(root,'notes',meta.version+'.md'))?readFileSync(join(root,'notes',meta.version+'.md'),'utf8'):'MARKPROTO '+meta.version+' ('+meta.platform+')\n\n'+(extension==='.dmg'?'DMG를 열고 앱을 응용 프로그램 폴더로 끌어다 놓아 대치함. Apple 공증은 아직 적용하지 않음.':'NSIS 설치 파일 또는 앱의 업데이트 버튼으로 설치함.')+'\n\n- 네이버 로그인 계정별 개인 문서와 이미지를 서버에 저장하고 다른 기기에서 이어서 편집함.\n- 오프라인 변경을 로컬에 보관하고 서버 연결이 복구되면 동기화함.\n- 기존 로컬 문서는 자동 업로드하지 않고 선택한 문서만 계정으로 복사함.\n- 동시 수정 충돌 시 로컬 원본을 별도 사본으로 보존함.\n\n계정 동기화에는 새 버전의 실행 중인 MARKPROTO 웹 서버와 동일한 서버 주소 설정이 필요함. 서버 중단 시 로컬 편집은 유지함.\n');
      // Draft keeps partial uploads out of update discovery. Existing tags never get overwritten.
      const existing=spawnSync('gh',['release','view',tag,'--repo',repository,'--json','tagName'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      if(existing.status===0){
        const verified=join(dir,'remote-verification');mkdirSync(verified,{recursive:true});
        run('gh',['release','download',tag,'--repo',repository,'--dir',verified,'--clobber','--pattern',meta.file,'--pattern',file,'--pattern',meta.file+'.sig']);
        cpSync(join(verified,meta.file+'.sig'),artifact+'.sig');
        const remoteMeta=JSON.parse(readFileSync(join(verified,file)));
        if(remoteMeta.desktopCommit!==meta.desktopCommit || remoteMeta.appCommit!==meta.appCommit || createHash('sha256').update(readFileSync(join(verified,meta.file))).digest('hex')!==meta.sha256)throw Error('Existing release differs; do not overwrite');
      }else{
        run('gh',['release','create',tag,'--repo',repository,'--draft','--title','MARKPROTO '+meta.version+' · '+meta.platform,'--notes-file',notes,artifact,artifact+'.sig',checksum,join(dir,file)]);
      }
      if(stageOnly){console.log('Draft ready: '+tag);continue;}
      run('gh',['release','edit',tag,'--repo',repository,'--draft=false']);
      const manifest={version:meta.version,notes:'MARKPROTO '+meta.version,pub_date:new Date().toISOString(),url:'https://github.com/'+downloadRepository+'/releases/download/'+tag+'/'+meta.file,signature:readFileSync(artifact+'.sig','utf8').trim()};
      writeFileSync(channel,JSON.stringify(manifest,null,2)+'\n');
      run('git',['add','channels/'+file]);run('git',['commit','-m','release: publish '+tag]);visible('git',['push']);
    }
  }
}
const [command,which]=process.argv.slice(2);
if(command==='build')await build(which);else if(command==='publish')publish();else if(command==='stage')publish(true);else throw Error('Use: node scripts/release.js build [local|remote] | publish');
