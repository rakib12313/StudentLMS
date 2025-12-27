import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, serverTimestamp, addDoc, arrayUnion, deleteDoc, where, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let user = null;
let allContent = [];
let currentExam = null;
let timerInt = null;

// Auth with Auto-Registration + Device Lock
onAuthStateChanged(auth, async (u) => {
    if(u) {
        const ref = doc(db, "students", u.uid);
        const snap = await getDoc(ref);
        const did = localStorage.getItem('did') || crypto.randomUUID();
        localStorage.setItem('did', did);

        if(!snap.exists()) {
            // Auto Register
            const newUser = { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL, role: "student", batch: "all", deviceId: did, createdAt: serverTimestamp(), xp: 0, streak: 1 };
            await setDoc(ref, newUser);
            user = newUser;
        } else {
            const d = snap.data();
            if(d.deviceId && d.deviceId !== did) { alert("Locked to another device."); return signOut(auth); }
            if(!d.deviceId) await updateDoc(ref, { deviceId: did });
            
            const today = new Date().toDateString();
            if(!d.attendance || !d.attendance.includes(today)) await updateDoc(ref, { attendance: arrayUnion(today), streak: (d.streak||0)+1 });
            user = d;
        }
        initUI();
    } else {
        document.getElementById('login-section').classList.remove('hidden');
        document.getElementById('dashboard-section').classList.add('hidden');
    }
});

document.getElementById('google-btn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.reload()));

async function initUI() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Bind Profile
    document.getElementById('nav-name').innerText = user.name;
    document.getElementById('nav-batch').innerText = user.batch === 'all' ? 'All' : 'Class '+user.batch;
    document.getElementById('nav-photo').src = user.photo;
    document.getElementById('profile-lg').src = user.photo;
    document.getElementById('p-name').innerText = user.name;
    document.getElementById('xp-stat').innerText = user.xp || 0;
    document.getElementById('streak-stat').innerText = user.streak || 1;
    
    // Gen Watermark
    const wm = document.getElementById('watermark-layer');
    wm.innerHTML = new Array(20).fill(`<div>${user.email}</div>`).join('');

    loadContent();
    loadExams();
    loadTasks();
    loadForum();
    checkLive();
    renderAttendance();
}

// Unified Content Loader
async function loadContent() {
    allContent = [];
    const grid = document.getElementById('content-grid');
    grid.innerHTML = "";

    // Notes
    const nS = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    nS.forEach(d => { if(checkBatch(d.data())) allContent.push({...d.data(), type: 'note'}); });

    // Videos
    const vS = await getDocs(query(collection(db, "videos"), orderBy("createdAt", "desc")));
    vS.forEach(d => { if(checkBatch(d.data())) allContent.push({...d.data(), type: 'video'}); });

    // Flashcards
    const fS = await getDocs(query(collection(db, "flashcards"), orderBy("createdAt", "desc")));
    fS.forEach(d => { allContent.push({...d.data(), type: 'flashcard'}); });

    renderContent(allContent);
}

function checkBatch(item) { return item.batch === "all" || item.batch === user.batch; }

function renderContent(list) {
    const grid = document.getElementById('content-grid');
    grid.innerHTML = list.map(i => {
        if(i.type === 'note') return `
        <div class="glass-panel p-4 flex items-center gap-3 cursor-pointer" onclick="openPDF('${i.url}')">
            <div class="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><i class="fas fa-file-alt"></i></div>
            <div class="flex-grow"><h4 class="font-bold text-sm">${i.title}</h4><span class="text-[10px] text-slate-400">PDF Note</span></div>
            <button onclick="event.stopPropagation(); speak('${i.title}')" class="text-slate-400"><i class="fas fa-volume-up"></i></button>
        </div>`;
        if(i.type === 'video') return `
        <div class="glass-panel p-2">
            <iframe src="https://www.youtube.com/embed/${i.url.split('/').pop()}" class="w-full rounded-lg h-40 mb-2"></iframe>
            <p class="font-bold text-xs px-2 pb-1">${i.title}</p>
        </div>`;
        if(i.type === 'flashcard') return `
        <div class="flashcard" onclick="this.classList.toggle('flipped')">
            <div class="flashcard-inner">
                <div class="fc-front"><p class="font-bold">${i.front}</p></div>
                <div class="fc-back"><p class="font-bold text-white">${i.back}</p></div>
            </div>
        </div>`;
    }).join('');
}

window.filterType = (t) => renderContent(allContent.filter(i => i.type === t));
window.searchContent = () => { const v = document.getElementById('search-bar').value.toLowerCase(); renderContent(allContent.filter(i => i.title?.toLowerCase().includes(v) || i.front?.toLowerCase().includes(v))); };
window.speak = (t) => window.speechSynthesis.speak(new SpeechSynthesisUtterance(t));

// Exams
async function loadExams() {
    const s = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const g = document.getElementById('exams-grid');
    let h = '';
    s.forEach(d => {
        const e = d.data();
        if(checkBatch(e)) h += `
        <div class="glass-panel p-4 flex justify-between items-center border-l-4 border-pink-500">
            <div><h4 class="font-bold text-sm">${e.title}</h4><p class="text-[10px] opacity-60">${e.duration} Mins • ${e.answerKey.length} Qs</p></div>
            <button onclick="startExam('${d.id}')" class="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold">Start</button>
        </div>`;
    });
    g.innerHTML = h;
}

// Tasks & Homework
async function loadTasks() {
    const hw = await getDocs(collection(db,"assignments"));
    document.getElementById('hw-list').innerHTML = hw.docs.map(d=>`<div class="glass-panel p-3 border-l-4 border-orange-500 text-xs font-bold">${d.data().title} <span class="float-right opacity-50">Due: ${d.data().date}</span></div>`).join('');
    
    const t = await getDocs(query(collection(db,"tasks"), where("uid","==",user.uid)));
    document.getElementById('task-list').innerHTML = t.docs.map(d=>`<div class="flex justify-between text-xs p-2 border-b"><span>${d.data().txt}</span><button onclick="delTask('${d.id}')" class="text-red-500">&times;</button></div>`).join('');
}
window.addTask = async () => { const v = document.getElementById('new-task').value; if(v) await addDoc(collection(db,"tasks"),{uid:user.uid, txt:v}); loadTasks(); };
window.delTask = async (id) => { await deleteDoc(doc(db,"tasks",id)); loadTasks(); };

// Forum
async function loadForum() {
    const q = query(collection(db,"forum"), orderBy("createdAt", "desc"), limit(20));
    const s = await getDocs(q);
    document.getElementById('chat-box').innerHTML = s.docs.reverse().map(d=> {
        const m = d.data();
        return `<div class="mb-2"><span class="text-[10px] font-bold text-indigo-600">${m.name}</span><div class="bg-white p-2 rounded-lg text-xs shadow-sm">${m.txt}</div></div>`;
    }).join('');
}
window.sendChat = async () => { const v = document.getElementById('chat-in').value; if(v) await addDoc(collection(db,"forum"),{name:user.name, txt:v, createdAt: serverTimestamp()}); document.getElementById('chat-in').value=""; loadForum(); };

// Anti-Cheat Exam
window.startExam = async (id) => {
    const s = await getDoc(doc(db,"exams",id));
    currentExam = { id: s.id, ...s.data() };
    document.getElementById('exam-runner').classList.remove('hidden');
    document.getElementById('exam-pdf').src = currentExam.fileUrl;
    
    let h = ''; currentExam.answerKey.forEach((k,i)=> h+=`<div class="p-3 bg-slate-50 rounded mb-2 flex justify-between"><span class="font-bold text-sm">Q${i+1}</span><div class="flex gap-3">${['A','B','C','D'].map((o,v)=>`<label><input type="radio" name="q${i}" value="${v}"> ${o}</label>`).join('')}</div></div>`);
    document.getElementById('exam-qs').innerHTML = h;
    
    let t = currentExam.duration*60;
    timerInt = setInterval(()=>{ t--; document.getElementById('timer').innerText=`${Math.floor(t/60)}:${t%60}`; if(t<=0) finishExam(); },1000);

    // Anti-Cheat
    document.addEventListener("visibilitychange", () => {
        if(document.hidden) { alert("WARNING: Tab switching detected! Exam will auto-submit next time."); finishExam(); }
    });
};

window.finishExam = async () => {
    clearInterval(timerInt);
    let score = 0; currentExam.answerKey.forEach((k,i)=>{ const el = document.querySelector(`input[name="q${i}"]:checked`); if(el && parseInt(el.value)===k) score++; });
    await updateDoc(doc(db,"students",user.uid),{xp:(user.xp||0)+(score*10)});
    document.getElementById('exam-runner').classList.add('hidden');
    confetti(); alert(`Score: ${score}`); location.reload();
};

// Utils
async function checkLive() { const s = await getDoc(doc(db,"settings","live")); if(s.exists()&&s.data().active) { document.getElementById('live-banner').classList.remove('hidden'); document.getElementById('live-btn').href=s.data().url; } }
async function checkNotice() { const s = await getDoc(doc(db,"settings","announcement")); if(s.exists()) { document.getElementById('notice-box').classList.remove('hidden'); document.getElementById('notice-text').innerText=s.data().text; } }
window.openPDF = (u) => { document.getElementById('viewer-modal').classList.remove('hidden'); document.getElementById('pdf-frame').src=u; };
window.loadLeaderboard = async () => {
    const s = await getDocs(query(collection(db,"students"), orderBy("xp","desc"), limit(10)));
    document.getElementById('lb-list').innerHTML = s.docs.map((d,i)=>`<div class="flex justify-between text-xs p-2 border-b"><span>#${i+1} ${d.data().name}</span><span class="font-bold text-indigo-600">${d.data().xp} XP</span></div>`).join('');
};
function renderAttendance() { const g=document.getElementById('attendance-grid'); g.innerHTML=""; for(let i=1;i<=30;i++){ const d=new Date(new Date().getFullYear(),new Date().getMonth(),i).toDateString(); g.innerHTML+=`<div class="w-6 h-6 rounded flex items-center justify-center text-[9px] ${user.attendance?.includes(d)?'bg-green-500 text-white':'bg-slate-100'}">${i}</div>`; } }