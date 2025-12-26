import { auth, db, provider } from './firebase-config.js';
import { signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;
let allNotes = [];

// --- UTILS ---
function showToast(msg, type = 'neutral') {
    const box = document.getElementById('toast-container');
    const el = document.createElement('div');
    const icon = type === 'success' ? 'check-circle text-green-400' : (type === 'error' ? 'exclamation-circle text-red-400' : 'info-circle text-blue-400');
    el.className = "toast";
    el.innerHTML = `<i class="fas fa-${icon}"></i> <span>${msg}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// --- LOGIN (REDIRECT METHOD) ---
async function checkRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            document.getElementById('login-status').innerText = "Verifying Database...";
            handleUser(result.user);
        }
    } catch (error) {
        alert("Login Failed: " + error.message);
    }
}
checkRedirect();

const loginBtn = document.getElementById('google-login-btn');
if(loginBtn) {
    loginBtn.addEventListener('click', async () => {
        loginBtn.disabled = true;
        loginBtn.innerHTML = "🔄 Redirecting to Google...";
        try {
            await signInWithRedirect(auth, provider);
        } catch (error) {
            alert("Error: " + error.message);
            loginBtn.disabled = false;
            loginBtn.innerHTML = "Login with Gmail";
        }
    });
}

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

// --- USER CHECK (STRICT) ---
async function handleUser(user) {
    const status = document.getElementById('login-status');
    if(status) status.innerText = "Checking permissions...";

    try {
        const userRef = doc(db, "students", user.uid);
        let snap = await getDoc(userRef);

        if (snap.exists()) {
            currentUser = snap.data();
            initDashboard();
            return;
        }

        const q = query(collection(db, "students"), where("email", "==", user.email));
        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
            const preData = querySnap.docs[0].data();
            const oldId = querySnap.docs[0].id;
            
            await setDoc(userRef, {
                ...preData,
                uid: user.uid,
                name: user.displayName,
                photo: user.photoURL,
                role: preData.role || 'student',
                approved: true
            });
            
            if(oldId !== user.uid) await deleteDoc(doc(db, "students", oldId));
            currentUser = { ...preData, uid: user.uid, name: user.displayName, photo: user.photoURL };
            initDashboard();
        } else {
            alert("⛔ ACCESS DENIED\n\nEmail: " + user.email + "\nStatus: Not Registered.\n\nPlease ask the Admin to register you.");
            await signOut(auth);
            showLoginScreen();
            if(loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = "Login with Gmail";
            }
        }
    } catch(err) {
        alert("DB Error: " + err.message);
    }
}

function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('profile-photo').src = currentUser.photo;

    // Show Admin Button
    if (currentUser.role === 'admin') {
        document.getElementById('admin-link-btn').classList.remove('hidden');
    }
    
    loadAnnouncement();
    loadNotes();
    loadExams();
    loadLeaderboard();
}

// --- STUDENT FEATURES ---
async function loadAnnouncement() {
    const snap = await getDoc(doc(db, "settings", "announcement"));
    if(snap.exists() && snap.data().text) {
        document.getElementById('announcement-area').classList.remove('hidden');
        document.getElementById('announcement-text').innerText = snap.data().text;
    }
}

async function loadNotes() {
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    allNotes = []; snaps.forEach(doc => allNotes.push(doc.data()));
    renderNotes(allNotes);
}

function renderNotes(notes) {
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    if(notes.length === 0) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No notes found.</p>";
    notes.forEach(n => {
        const icon = n.type === 'pdf' ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';
        list.innerHTML += `
        <div onclick="openViewer('${n.url}', '${n.type}')" class="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition cursor-pointer shadow-sm">
            <div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center"><i class="fas ${icon} text-lg"></i></div>
            <div class="flex-grow overflow-hidden"><h4 class="font-bold text-slate-700 text-xs truncate">${n.title}</h4><span class="text-[10px] text-slate-400 uppercase">${n.type}</span></div>
        </div>`;
    });
}

document.getElementById('global-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    renderNotes(allNotes.filter(n => n.title.toLowerCase().includes(term)));
});

// --- EXAMS ---
async function loadExams() {
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = []; resSnaps.forEach(doc => takenIds.push(doc.data().examId));
    
    const list = document.getElementById('exams-list'); list.innerHTML = "";
    if(snaps.empty) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No exams available.</p>";

    snaps.forEach(doc => {
        const e = doc.data();
        const isTaken = takenIds.includes(doc.id);
        list.innerHTML += `
        <div class="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isTaken?'bg-green-100 text-green-600':'bg-indigo-100 text-indigo-600'}"><i class="fas ${isTaken?'fa-check':'fa-pen'}"></i></div>
                <div><h3 class="font-bold text-slate-700 text-xs truncate w-32">${e.title}</h3><p class="text-[10px] text-slate-400">${e.duration}m • ${e.questions.length}Q</p></div>
            </div>
            ${!isTaken ? `<button onclick="startExam('${doc.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">Start</button>` : `<span class="text-[10px] font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Done</span>`}
        </div>`;
    });
    
    if(takenIds.length > 0) {
        document.getElementById('student-score-card').classList.remove('hidden');
        const resList = document.getElementById('my-results-list'); resList.innerHTML = "";
        resSnaps.forEach(doc => { const r = doc.data(); resList.innerHTML += `<div class="flex justify-between bg-slate-50 p-2 rounded-lg text-xs"><span class="font-bold text-slate-600 truncate w-32">${r.examTitle}</span><span class="font-bold text-green-600">${r.score}/${r.total}</span></div>`; });
    }
}

window.startExam = async (eid) => {
    const docSnap = await getDoc(doc(db, "exams", eid)); currentExam = {id: docSnap.id, ...docSnap.data()};
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const area = document.getElementById('exam-questions-area'); area.innerHTML = "";
    currentExam.questions.forEach((q, idx) => {
        area.innerHTML += `<div class="bg-white p-4 rounded-xl shadow-sm mb-4"><p class="font-bold text-sm mb-2 text-slate-800">Q${idx+1}. ${q.text}</p><div class="space-y-2">${q.options.map((opt, i) => `<label class="flex items-center gap-2 bg-slate-50 p-3 rounded-lg cursor-pointer hover:bg-slate-100"><input type="radio" name="q-${idx}" value="${i}"> <span class="text-xs text-slate-600">${opt}</span></label>`).join('')}</div></div>`;
    });
    let time = currentExam.duration * 60; const disp = document.getElementById('timer-display');
    examTimer = setInterval(() => { time--; const m = Math.floor(time/60); const s = time%60; disp.innerText = `${m}:${s<10?'0'+s:s}`; if(time <= 0) submitExam(); }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer); let score=0; currentExam.questions.forEach((q, idx) => { const sel = document.querySelector(`input[name="q-${idx}"]:checked`); if(sel && parseInt(sel.value)===q.correct) score++; });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total: currentExam.questions.length, submittedAt: serverTimestamp() });
    document.getElementById('exam-taker-modal').classList.add('hidden'); showToast(`Score: ${score}`, 'success'); loadExams(); loadLeaderboard();
};

// --- LEADERBOARD ---
async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "results"), orderBy("score", "desc"), limit(10)));
    let rank=1; snaps.forEach(doc => { const r = doc.data(); list.innerHTML += `<div class="p-3 flex justify-between items-center"><div class="flex items-center gap-3"><span class="font-bold text-slate-300 text-lg w-6 text-center">${rank++}</span><div><div class="font-bold text-xs text-slate-700">${r.studentName}</div><div class="text-[10px] text-slate-400 truncate w-32">${r.examTitle}</div></div></div><span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">${r.score}/${r.total}</span></div>`; });
}

// --- GLOBAL UTILS ---
window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`); const view = document.getElementById(`view-${t}`);
        view.classList.toggle('hidden', t!==tab);
        btn.className = t===tab ? "flex-1 py-2.5 text-xs font-bold rounded-lg bg-white shadow text-blue-600 transition" : "flex-1 py-2.5 text-xs font-medium rounded-lg text-gray-400 hover:bg-gray-50 transition";
    });
};

window.openViewer = (url, type) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    const wm = document.getElementById('watermark-overlay'); wm.innerHTML = ""; 
    for(let i=0;i<30;i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`;
    const pdf = document.getElementById('pdf-frame'); const img = document.getElementById('image-frame');
    if(type === 'pdf') { pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden'); } else { img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden'); }
};
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src = ""; };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => location.reload()));