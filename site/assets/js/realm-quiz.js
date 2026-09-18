(() => {
  'use strict';

  const realmOrder=['light','balance','fire','night'];
  const realmData={
    light:{slug:'aureva',name:'AUREVA',roman:'I',element:'LIGHT',headline:'You move toward what opens the world.',body:'You are drawn to uplift, possibility and the feeling of a horizon getting wider. Your strongest energy is expressive without needing to dominate the room: bright, emotionally open and ready for the next beginning.',traits:['Radiant','Expansive','Euphoric','Renewing'],route:'/events/aureva',logo:'/assets/images/realms/aureva-1200.webp'},
    balance:{slug:'halora',name:'HALORA',roman:'II',element:'BALANCE',headline:'You feel the room before you move through it.',body:'You gravitate toward alignment, connection and the exact moment opposing energies lock together. Your strongest energy is intentional: social without being chaotic, observant without standing still, always looking for the point where everything clicks.',traits:['Centered','Connected','Hypnotic','Intentional'],route:'/events/halora',logo:'/assets/images/realms/halora-1200.webp'},
    fire:{slug:'sunveil',name:'SUNVEIL',roman:'III',element:'FIRE',headline:'You came to move, release and feel everything fully.',body:'You are pulled toward momentum, heat and the moment restraint gives way to motion. Your strongest energy is kinetic and contagious: bold enough to start the charge and alive enough to keep it moving until the room transforms.',traits:['Kinetic','Bold','Tropical','Unleashed'],route:'/events/sunveil',logo:'/assets/images/realms/sunveil-1200.webp'},
    night:{slug:'nocturne',name:'NOCTURNE',roman:'IV',element:'NIGHT',headline:'You are most alive when the obvious disappears.',body:'You are drawn to mystery, depth and experiences that feel discovered rather than advertised. Your strongest energy is immersive and magnetic: comfortable after dark, curious about what is hidden and willing to follow the night somewhere unexpected.',traits:['Mysterious','Immersive','Magnetic','Nocturnal'],route:'/events/nocturne',logo:'/assets/images/realms/nocturne-1200.webp'}
  };

  const questions=[
    {q:'The night is opening. Where do you drift first?',a:[
      ['Toward open air, a wide horizon and the first hint of dawn',{light:3,balance:1}],
      ['Into the place where the crowd, sound and space feel perfectly aligned',{balance:3,night:1}],
      ['Wherever the movement is biggest and the energy keeps climbing',{fire:3,light:1}],
      ['Past the obvious room, toward the part that feels hidden and undiscovered',{night:3,balance:1}]
    ]},
    {q:'What kind of energy do you chase in a great set?',a:[
      ['The euphoric lift that makes everything feel possible again',{light:3,fire:1}],
      ['The locked-in groove where everyone seems to breathe together',{balance:3,light:1}],
      ['The pressure, release and drop that takes over your whole body',{fire:3,night:1}],
      ['The deep, strange pull that makes you forget what time it is',{night:3,balance:1}]
    ]},
    {q:'Choose the setting that feels most like you.',a:[
      ['First light over the ocean after a long night',{light:3,balance:1}],
      ['Twilight — exactly between what is ending and what is beginning',{balance:3,night:1}],
      ['Golden hour, tropical heat and a sky still burning',{fire:3,light:1}],
      ['A moonlit world that only really exists after dark',{night:3,fire:1}]
    ]},
    {q:'Your ideal musical journey builds toward…',a:[
      ['A huge emotional release that leaves you lighter than before',{light:3,balance:1}],
      ['A seamless flow where every transition feels inevitable',{balance:3,night:1}],
      ['A peak that makes standing still impossible',{fire:3,light:1}],
      ['A deeper, darker atmosphere that keeps pulling you inward',{night:3,fire:1}]
    ]},
    {q:'Inside a crowd, which version of you shows up?',a:[
      ['Open, expressive and lifting the energy around you',{light:3,fire:1}],
      ['Reading the room, connecting people and finding the shared rhythm',{balance:3,light:1}],
      ['Front and center — moving first and thinking later',{fire:3,night:1}],
      ['Exploring the edges, watching everything and finding the unexpected',{night:3,balance:1}]
    ]},
    {q:'Pick the word you would wear for one night.',a:[
      ['Radiance',{light:4}],
      ['Equilibrium',{balance:4}],
      ['Ignition',{fire:4}],
      ['Eclipse',{night:4}]
    ]},
    {q:'When the final track ends, what do you want to feel?',a:[
      ['Renewed — like something just opened',{light:3,balance:1}],
      ['Centered — like everything landed exactly where it should',{balance:3,light:1}],
      ['Unleashed — exhausted in the best possible way',{fire:3,night:1}],
      ['Changed — like you came back from somewhere hard to explain',{night:3,fire:1}]
    ]}
  ];

  const intro=document.querySelector('#quizIntro');
  const stage=document.querySelector('#quizStage');
  const result=document.querySelector('#quizResult');
  const title=document.querySelector('#questionTitle');
  const answers=document.querySelector('#quizAnswers');
  const step=document.querySelector('#quizStep');
  const progress=document.querySelector('#quizProgressBar');
  const back=document.querySelector('#quizBack');
  const status=document.querySelector('#quizStatus');
  let index=0;
  let selections=[];

  const resetRealm=()=>{document.body.dataset.realm='cycle'; if(window.WildOnesBrand) window.WildOnesBrand.sync();};
  const show=(el)=>{el.hidden=false};
  const hide=(el)=>{el.hidden=true};

  function start(){
    selections=[];index=0;hide(intro);hide(result);show(stage);resetRealm();render();window.scrollTo({top:0,behavior:'smooth'});
  }

  function render(){
    const item=questions[index];
    step.textContent=`QUESTION ${index+1} / ${questions.length}`;
    progress.style.width=`${((index+1)/questions.length)*100}%`;
    title.textContent=item.q;
    answers.replaceChildren();
    back.hidden=index===0;
    item.a.forEach((entry,i)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='quiz-answer';
      button.dataset.letter=String.fromCharCode(65+i);
      button.textContent=entry[0];
      button.addEventListener('click',()=>choose(i));
      answers.append(button);
    });
    status.textContent=`Question ${index+1} of ${questions.length}`;
    requestAnimationFrame(()=>answers.querySelector('button')?.focus({preventScroll:true}));
  }

  function choose(answerIndex){
    selections[index]=answerIndex;
    if(index<questions.length-1){index+=1;render();return}
    calculate();
  }

  function goBack(){
    if(index===0){show(intro);hide(stage);return}
    index-=1;render();
  }

  function calculate(){
    const scores=Object.fromEntries(realmOrder.map(k=>[k,0]));
    const recency=Object.fromEntries(realmOrder.map(k=>[k,0]));
    selections.forEach((answerIndex,questionIndex)=>{
      const weights=questions[questionIndex].a[answerIndex][1];
      Object.entries(weights).forEach(([realm,points])=>{
        scores[realm]+=points;
        recency[realm]=questionIndex+1;
      });
    });
    const winner=[...realmOrder].sort((a,b)=>(scores[b]-scores[a])||((recency[b]||0)-(recency[a]||0))||(realmOrder.indexOf(a)-realmOrder.indexOf(b)))[0];
    showResult(winner,true);
  }

  function showResult(realm,updateUrl=false){
    const data=realmData[realm];
    if(!data)return;
    hide(intro);hide(stage);show(result);
    document.body.dataset.realm=realm;
    if(window.WildOnesBrand) window.WildOnesBrand.sync();
    document.querySelector('#resultEyebrow').textContent=`REALM ${data.roman} / ${data.element}`;
    document.querySelector('#resultName').textContent=data.name;
    document.querySelector('#resultHeadline').textContent=data.headline;
    document.querySelector('#resultBody').textContent=data.body;
    const logo=document.querySelector('#resultLogo'); logo.src=data.logo; logo.alt=`${data.name} - Realm ${data.roman} - ${data.element}`;
    document.querySelector('#resultExplore').href=data.route;
    const traits=document.querySelector('#resultTraits'); traits.replaceChildren(...data.traits.map(t=>{const s=document.createElement('span');s.textContent=t;return s}));
    if(updateUrl){
      const url=new URL(location.href);url.searchParams.set('realm',data.slug);history.replaceState({},'',url);
    }
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function share(){
    const realm=realmOrder.find(k=>document.body.dataset.realm===k);
    const data=realmData[realm];
    if(!data)return;
    const url=new URL(location.href);url.searchParams.set('realm',data.slug);
    const shareData={title:`My Wild Ones Realm: ${data.name}`,text:`I took Find Your Realm. My match is ${data.name} — Realm ${data.roman}: ${data.element}.`,url:url.toString()};
    try{
      if(navigator.share){await navigator.share(shareData);document.querySelector('#shareStatus').textContent='Result shared.'}
      else{await navigator.clipboard.writeText(url.toString());document.querySelector('#shareStatus').textContent='Result link copied.'}
    }catch(e){if(e?.name!=='AbortError')document.querySelector('#shareStatus').textContent='Use your browser share controls to share this result.'}
  }

  document.querySelector('#quizStart')?.addEventListener('click',start);
  document.querySelector('#quizBack')?.addEventListener('click',goBack);
  document.querySelector('#quizRetake')?.addEventListener('click',()=>{
    const url=new URL(location.href);url.searchParams.delete('realm');history.replaceState({},'',url);
    selections=[];index=0;hide(result);show(intro);resetRealm();window.scrollTo({top:0,behavior:'smooth'});document.querySelector('#quizStart')?.focus({preventScroll:true});
  });
  document.querySelector('#quizShare')?.addEventListener('click',share);

  const requested=(new URLSearchParams(location.search).get('realm')||'').toLowerCase();
  const alias={aureva:'light',light:'light',halora:'balance',balance:'balance',sunveil:'fire',fire:'fire',nocturne:'night',night:'night'};
  if(alias[requested]) showResult(alias[requested]);
})();