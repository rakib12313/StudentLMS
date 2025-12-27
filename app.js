import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, serverTimestamp, addDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let user = null;
let allNotes = [];
let currentExam = null;
let timerInt = null;

// Auth Logic: Auto-Register New Users
onAuthStateChanged(auth, async (u) => {
    if(u) {
        const ref = doc(db, "students", u.uid);
        const snap = await getDoc(ref);
        const did = localStorage.getItem('did') || crypto.randomUUID();
        localStorage.setItem('did', did);

        if(!snap.exists()) {
            // New User? Auto Create!
            const userData = {
                uid: u.uid,
                email: u.email,
                name: u.displayName || "Student",
                photo: u.photoURL,
                role: "student",
                batch: "all", // Default access
                deviceId: did,
                createdAt: serverTimestamp(),
                xp: 0,
                streak: 1
            };
            await setDoc(ref, userData);
            user = userData;
        } else {
            // Existing User
            const d = snap.data();
            if(d.deviceId && d.deviceId !== did) {
                alert("Account locked to another device.");
                signOut(auth); return;
            }
            if(!d.deviceId) await updateDoc(ref, { deviceId: did });
            
            // Streak Update
            const today = new Date().toDateString();
            if(!d.attendance || !d.attendance.includes(today)) {
                await updateDoc(ref, { attendance: arrayUnion(today), streak: (d.streak||0)+1 });
            }
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

// UI Init
async function initUI() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Bind Data
    document.getElementById('nav-name').innerText = user.name;
    document.getElementById('nav-batch').innerText = user.batch === 'all' ? 'All Access' : 'Class ' + user.batch;
    document.getElementById('nav-photo').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    document.getElementById('profile-lg').src = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    document.getElementById('p-name').innerText = user.name;
    document.getElementById('p-email').innerText = user.email;
    document.getElementById('xp-stat').innerText = user.xp || 0;
    document.getElementById('streak-stat').innerText = user.streak || 1;

    // Load Data
    loadNotes();
    loadExams();
    checkLive();
    checkNotice();
}

async function loadNotes() {
    const q = query(collection(db, "notes"), orderBy("createdAt", "desc"));
    const snaps = await getDocs(q);
    const grid = document.getElementById('notes-grid');
    let html = "";
    allNotes = [];

    snaps.forEach(d => {
        const n = d.data();
        if(n.batch === "all" || n.batch === user.batch) {
            allNotes.push(n);
            html += `
            <div class="glass-card p-4 flex items-center gap-4 cursor-pointer" onclick="openPDF('${n.url}')">
                <div class="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600"><i class="fas fa-file-alt text-xl"></i></div>
                <div>
                    <h4 class="font-bold text-sm text-slate-700">${n.title}</h4>
                    <span class="text-[10px] text-slate-400">Tap to Read</span>
                </div>
            </div>`;
        }
    });
    grid.innerHTML = html;
}

window.filterNotes = () => {
    const term = document.getElementById('search-bar').value.toLowerCase();
    const grid = document.getElementById('notes-grid');
    let html = "";
    allNotes.filter(n => n.title.toLowerCase().includes(term)).forEach(n => {
        html += `<div class="glass-card p-4 flex items-center gap-4 cursor-pointer" onclick="openPDF('${n.url}')">
             <div class="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600"><i class="fas fa-file-alt text-xl"></i></div>
             <div><h4 class="font-bold text-sm text-slate-700">${n.title}</h4></div>
        </div>`;
    });
    grid.innerHTML = html;
};

async function loadExams() {
    const q = query(collection(db, "exams"), orderBy("createdAt", "desc"));
    const snaps = await getDocs(q);
    const grid = document.getElementById('exams-grid');
    let html = "";
    snaps.forEach(d => {
        const e = d.data();
        if(e.batch === "all" || e.batch === user.batch) {
            html += `
            <div class="glass-card p-4 flex justify-between items-center border-l-4 border-pink-500">
                <div>
                    <h4 class="font-bold text-slate-700 text-sm">${e.title}</h4>
                    <p class="text-[10px] text-slate-400">${e.duration} Mins • ${e.answerKey.length} Qs</p>
                </div>
                <button onclick="startExam('${d.id}')" class="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold">Start</button>
            </div>`;
        }
    });
    grid.innerHTML = html || '<p class="text-center text-slate-400 text-xs">No exams found</p>';
}

// Features
async function checkLive() {
    const s = await getDoc(doc(db, "settings", "live"));
    if(s.exists() && s.data().active) {
        document.getElementById('live-banner').classList.remove('hidden');
        document.getElementById('live-btn').href = s.data().url;
    }
}
async function checkNotice() {
    const s = await getDoc(doc(db, "settings", "announcement"));
    if(s.exists()) {
        document.getElementById('notice-box').classList.remove('hidden');
        document.getElementById('notice-text').innerText = s.data().text;
    }
}

// Helpers
window.openPDF = (url) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    document.getElementById('pdf-frame').src = url;
};

// Exam Logic
window.startExam = async (id) => {
    const s = await getDoc(doc(db,"exams",id));
    currentExam = { id: s.id, ...s.data() };
    document.getElementById('exam-runner').classList.remove('hidden');
    document.getElementById('exam-pdf').src = currentExam.fileUrl;
    
    let html = '';
    currentExam.answerKey.forEach((k,i) => {
        html += `<div class="p-3 bg-slate-50 rounded-lg border flex justify-between items-center">
            <span class="font-bold text-sm text-slate-600">Q${i+1}</span>
            <div class="flex gap-4">
                ${['A','B','C','D'].map((o,v) => `<label class="font-bold text-slate-500"><input type="radio" name="q${i}" value="${v}"> ${o}</label>`).join('')}
            </div>
        </div>`;
    });
    document.getElementById('exam-qs').innerHTML = html;
    
    let t = currentExam.duration * 60;
    timerInt = setInterval(() => {
        t--;
        document.getElementById('timer').innerText = `${Math.floor(t/60)}:${(t%60).toString().padStart(2,'0')}`;
        if(t<=0) finishExam();
    }, 1000);
};

window.finishExam = async () => {
    clearInterval(timerInt);
    let score = 0;
    currentExam.answerKey.forEach((k,i) => {
        const el = document.querySelector(`input[name="q${i}"]:checked`);
        if(el && parseInt(el.value) === k) score++;
    });
    
    await addDoc(collection(db,"results"), {
        examId: currentExam.id, student: user.name, score, total: currentExam.answerKey.length, timestamp: serverTimestamp()
    });
    
    await updateDoc(doc(db,"students",user.uid), { xp: (user.xp||0)+(score*10) });
    document.getElementById('exam-runner').classList.add('hidden');
    confetti();
    alert(`Score: ${score}/${currentExam.answerKey.length}`);
    location.reload();
};