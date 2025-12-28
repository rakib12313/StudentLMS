import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, serverTimestamp, addDoc, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let user = null;
let currentExam = null;
let userAnswers = [];
let currQIndex = 0;
let timerInt = null;

// Auth Logic
onAuthStateChanged(auth, async (u) => {
    if(u) {
        const ref = doc(db, "students", u.uid);
        const snap = await getDoc(ref);
        if(!snap.exists()) {
            const d = { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL, role: "student", batch: "all", xp: 0 };
            await setDoc(ref, d); user = d;
        } else user = snap.data();
        initUI();
    } else document.getElementById('login-section').classList.remove('hidden');
});

document.getElementById('google-btn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.reload()));

async function initUI() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('u-name').innerText = user.name;
    document.getElementById('u-img').src = user.photo;
    
    // Load Exams
    const q = query(collection(db, "exams"), orderBy("createdAt", "desc"));
    const s = await getDocs(q);
    document.getElementById('exam-list').innerHTML = s.docs.map(d => {
        const e = d.data();
        if(e.batch === "all" || e.batch === user.batch) {
            return `
            <div class="card p-4 flex justify-between items-center border-l-4 border-indigo-500">
                <div><h4 class="font-bold text-sm text-slate-700">${e.title}</h4><span class="text-[10px] text-slate-400 font-bold uppercase">${e.type==='native_exam'?'CBT Mode':'PDF Mode'} • ${e.duration} Mins</span></div>
                <button onclick="startExam('${d.id}')" class="btn btn-primary text-xs">Start</button>
            </div>`;
        }
    }).join('') || "<p class='text-center text-slate-400 text-sm'>No Active Exams</p>";

    // Load History
    const hQ = query(collection(db, "results"), where("uid","==",user.uid), orderBy("timestamp","desc"));
    const hS = await getDocs(hQ);
    document.getElementById('result-list').innerHTML = hS.docs.map(d => `<div class="card p-3 flex justify-between items-center" onclick="showAnalysisDoc('${d.id}')"><div><span class="font-bold text-sm block">${d.data().title}</span><span class="text-[10px] text-slate-400">View Analysis</span></div><span class="font-bold text-indigo-600">${d.data().score}</span></div>`).join('');
}

// --- CBT ENGINE ---
window.startExam = async (id) => {
    const s = await getDoc(doc(db,"exams",id));
    currentExam = { id: s.id, ...s.data() };
    
    // Auto-Resume
    const saved = JSON.parse(localStorage.getItem('exam_state'));
    if(saved && saved.eid === id && confirm("Resume previous session?")) {
        userAnswers = saved.ans;
        var t = saved.time;
        if(currentExam.randomize && saved.qs) currentExam.questions = saved.qs; // Restore shuffled order
    } else {
        if(currentExam.randomize && currentExam.type === 'native_exam') {
            currentExam.questions = currentExam.questions.sort(() => Math.random() - 0.5);
        }
        const len = currentExam.type==='native_exam' ? currentExam.questions.length : currentExam.answerKey.length;
        userAnswers = Array(len).fill().map(() => ({ val: -1, status: 'st-visit' }));
        var t = currentExam.duration * 60;
    }

    // Setup Interface
    document.getElementById('exam-runner').classList.remove('hidden');
    document.getElementById('run-title').innerText = currentExam.title;
    
    if(currentExam.type === 'pdf_exam') {
        document.getElementById('exam-pdf').src = currentExam.fileUrl;
        document.getElementById('pdf-display').classList.remove('hidden');
        document.getElementById('native-q-display').classList.add('hidden');
    } else {
        document.getElementById('pdf-display').classList.add('hidden');
        document.getElementById('native-q-display').classList.remove('hidden');
        document.getElementById('q-pos').innerText = currentExam.posMarks;
        document.getElementById('q-neg').innerText = currentExam.negMarks;
    }

    renderPalette();
    loadQuestion(0);
    
    timerInt = setInterval(() => {
        t--;
        document.getElementById('timer').innerText = `${Math.floor(t/60)}:${(t%60).toString().padStart(2,'0')}`;
        // Save State
        localStorage.setItem('exam_state', JSON.stringify({ eid: id, ans: userAnswers, time: t, qs: currentExam.questions }));
        if(t<=0) finishExam();
    }, 1000);
    
    try{ document.documentElement.requestFullscreen(); }catch(e){}
};

function loadQuestion(idx) {
    currQIndex = idx;
    if(userAnswers[idx].status === 'st-visit') { userAnswers[idx].status = 'st-skipped'; renderPaletteItem(idx); }
    
    if(currentExam.type === 'native_exam') {
        const q = currentExam.questions[idx];
        document.getElementById('q-curr-num').innerText = idx + 1;
        document.getElementById('q-text').innerHTML = q.q; 
        
        const imgBox = document.getElementById('q-img-box');
        if(q.img) { imgBox.innerHTML = `<img src="${q.img}" class="q-img">`; imgBox.classList.remove('hidden'); }
        else imgBox.classList.add('hidden');

        document.getElementById('q-options').innerHTML = q.options.map((opt, v) => `
            <div class="option-box ${userAnswers[idx].val === v ? 'selected' : ''}" onclick="selectOption(${v})">
                <div class="opt-id">${String.fromCharCode(65+v)}</div>
                <span class="text-sm font-medium">${opt}</span>
            </div>
        `).join('');
        
        if(window.MathJax) MathJax.typesetPromise();
    }
    document.getElementById(`p-${idx}`)?.scrollIntoView({block:'nearest'});
}

window.selectOption = (v) => { userAnswers[currQIndex].val = v; userAnswers[currQIndex].status = 'st-answered'; renderPaletteItem(currQIndex); loadQuestion(currQIndex); };
window.markReview = () => { userAnswers[currQIndex].status = 'st-review'; renderPaletteItem(currQIndex); };
window.changeQ = (dir) => { const n = currQIndex + dir; if(n >= 0 && n < userAnswers.length) loadQuestion(n); };
function renderPalette() { document.getElementById('palette-grid').innerHTML = userAnswers.map((_, i) => `<div id="p-${i}" class="p-node st-visit" onclick="loadQuestion(${i})">${i+1}</div>`).join(''); }
function renderPaletteItem(i) { document.getElementById(`p-${i}`).className = `p-node ${userAnswers[i].status} ${i===currQIndex?'border-indigo-600 border-2':''}`; }
window.submitExamCheck = () => { if(confirm("Submit Exam?")) finishExam(); };

window.finishExam = async () => {
    clearInterval(timerInt);
    localStorage.removeItem('exam_state');
    if(document.fullscreenElement) document.exitFullscreen();

    let score = 0, correct = 0, wrong = 0;
    const pos = currentExam.posMarks || 4, neg = currentExam.negMarks || 1;
    const analysis = [];

    userAnswers.forEach((ans, i) => {
        let status = 'skipped', q = {};
        let correctVal = 0;

        if(currentExam.type === 'native_exam') {
            q = currentExam.questions[i];
            correctVal = q.correct;
        } else {
            correctVal = currentExam.answerKey[i];
            q = { q: `Question ${i+1}`, options: ['A','B','C','D'] };
        }

        if(ans.val !== -1) {
            if(ans.val === correctVal) { score += pos; correct++; status='correct'; }
            else { score -= neg; wrong++; status='wrong'; }
        }
        analysis.push({ q: q.q, img: q.img, user: ans.val, correct: correctVal, status, sol: q.sol, opts: q.options });
    });

    const res = { uid: user.uid, examId: currentExam.id, title: currentExam.title, score, total: userAnswers.length*pos, stats: {correct, wrong, skipped: userAnswers.length-(correct+wrong)}, analysis, timestamp: serverTimestamp() };
    await addDoc(collection(db, "results"), res);
    
    document.getElementById('exam-runner').classList.add('hidden');
    renderAnalysisData(res);
};

window.showAnalysisDoc = async(id) => { const s = await getDoc(doc(db,"results",id)); renderAnalysisData(s.data()); };

function renderAnalysisData(d) {
    document.getElementById('result-modal').classList.remove('hidden');
    document.getElementById('res-score').innerText = d.score;
    document.getElementById('res-acc').innerText = Math.round((d.stats.correct/(d.stats.correct+d.stats.wrong||1))*100) + "%";
    
    // Clear old chart
    const chartCanvas = document.getElementById('res-chart');
    const newCanvas = chartCanvas.cloneNode(true);
    chartCanvas.parentNode.replaceChild(newCanvas, chartCanvas);

    new Chart(newCanvas, {
        type: 'doughnut',
        data: { labels: ['Correct','Wrong','Skipped'], datasets: [{ data: [d.stats.correct, d.stats.wrong, d.stats.skipped], backgroundColor: ['#10b981','#ef4444','#cbd5e1'] }] }
    });

    document.getElementById('res-details').innerHTML = d.analysis.map((item, i) => `
        <div class="card p-4 border-l-4 ${item.status==='correct'?'border-green-500':item.status==='wrong'?'border-red-500':'border-slate-300'}">
            <p class="font-bold text-sm mb-2"><span class="text-slate-400">Q${i+1}</span> ${item.q}</p>
            ${item.img ? `<img src="${item.img}" class="h-20 mb-2 rounded border">` : ''}
            <div class="text-xs grid grid-cols-2 gap-2 text-slate-600 mb-2">
                <span>You: <b>${item.user===-1?'Skipped':String.fromCharCode(65+item.user)}</b></span>
                <span>Correct: <b>${String.fromCharCode(65+item.correct)}</b></span>
            </div>
            ${item.sol ? `<div class="bg-indigo-50 p-2 rounded text-xs text-indigo-800"><strong>💡 Solution:</strong> ${item.sol}</div>` : ''}
        </div>
    `).join('');
    
    if(window.MathJax) MathJax.typesetPromise();
}

window.showQP = () => {
    const win = window.open("", "QP", "width=800,height=600");
    win.document.write(`<html><head><title>QP</title><link rel="stylesheet" href="style.css"></head><body class="p-6">${currentExam.questions.map((q,i)=>`<div class="mb-4"><strong>Q${i+1}. ${q.q}</strong><br>${q.img?`<img src="${q.img}" style="height:100px"><br>`:''}${q.options.map((o,j)=>`(${String.fromCharCode(65+j)}) ${o} `).join('')}</div><hr>`).join('')}</body></html>`);
};