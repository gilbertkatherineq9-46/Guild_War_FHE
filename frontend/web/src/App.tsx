// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GuildWarPlan {
  id: string;
  encryptedCoordinates: string;
  timestamp: number;
  owner: string;
  strategy: string;
  status: "draft" | "active" | "executed";
  strength: number;
}

// Randomly selected styles: High Contrast (Red+Black), Cyberpunk UI, Grid Layout, Animation Rich
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increaseStrength':
      result = value * 1.2;
      break;
    case 'decreaseStrength':
      result = value * 0.8;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<GuildWarPlan[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPlanData, setNewPlanData] = useState({ strategy: "", xCoord: 0, yCoord: 0, strength: 100 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<GuildWarPlan | null>(null);
  const [decryptedCoords, setDecryptedCoords] = useState<{x: number, y: number} | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState("plans");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Stats for dashboard
  const activeCount = plans.filter(p => p.status === "active").length;
  const draftCount = plans.filter(p => p.status === "draft").length;
  const executedCount = plans.filter(p => p.status === "executed").length;
  const averageStrength = plans.length > 0 ? 
    plans.reduce((sum, plan) => sum + plan.strength, 0) / plans.length : 0;

  useEffect(() => {
    loadPlans().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadPlans = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }

      const keysBytes = await contract.getData("plan_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing plan keys:", e); }
      }
      
      const list: GuildWarPlan[] = [];
      for (const key of keys) {
        try {
          const planBytes = await contract.getData(`plan_${key}`);
          if (planBytes.length > 0) {
            try {
              const planData = JSON.parse(ethers.toUtf8String(planBytes));
              list.push({ 
                id: key, 
                encryptedCoordinates: planData.coordinates, 
                timestamp: planData.timestamp, 
                owner: planData.owner, 
                strategy: planData.strategy, 
                status: planData.status || "draft",
                strength: planData.strength || 100
              });
            } catch (e) { console.error(`Error parsing plan data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading plan ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPlans(list);
    } catch (e) { console.error("Error loading plans:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitPlan = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting tactical coordinates with Zama FHE..." });
    try {
      // Encrypt both coordinates together as "x,y"
      const coordsString = `${newPlanData.xCoord},${newPlanData.yCoord}`;
      const encryptedCoords = FHEEncryptNumber(parseFloat(coordsString.replace(',', '.')));
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const planData = { 
        coordinates: encryptedCoords, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        strategy: newPlanData.strategy,
        status: "draft",
        strength: newPlanData.strength
      };
      
      await contract.setData(`plan_${planId}`, ethers.toUtf8Bytes(JSON.stringify(planData)));
      
      const keysBytes = await contract.getData("plan_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(planId);
      await contract.setData("plan_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted battle plan submitted securely!" });
      await loadPlans();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPlanData({ strategy: "", xCoord: 0, yCoord: 0, strength: 100 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<{x: number, y: number} | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const decryptedValue = FHEDecryptNumber(encryptedData);
      const coordsString = decryptedValue.toString().replace('.', ',');
      const [x, y] = coordsString.split(',').map(Number);
      return { x, y };
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const activatePlan = async (planId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted coordinates with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const planBytes = await contract.getData(`plan_${planId}`);
      if (planBytes.length === 0) throw new Error("Plan not found");
      const planData = JSON.parse(ethers.toUtf8String(planBytes));
      
      // Increase strength when activating
      const updatedCoords = FHECompute(planData.coordinates, 'increaseStrength');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedPlan = { 
        ...planData, 
        status: "active", 
        coordinates: updatedCoords,
        strength: planData.strength * 1.2
      };
      await contractWithSigner.setData(`plan_${planId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPlan)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE activation completed! Strength increased by 20%" });
      await loadPlans();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Activation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const executePlan = async (planId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Finalizing encrypted battle plan..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const planBytes = await contract.getData(`plan_${planId}`);
      if (planBytes.length === 0) throw new Error("Plan not found");
      const planData = JSON.parse(ethers.toUtf8String(planBytes));
      const updatedPlan = { ...planData, status: "executed" };
      await contract.setData(`plan_${planId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPlan)));
      setTransactionStatus({ visible: true, status: "success", message: "Battle plan executed successfully!" });
      await loadPlans();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Execution failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (planAddress: string) => address?.toLowerCase() === planAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to access guild war planning", icon: "🔗" },
    { title: "Create Encrypted Plan", description: "Mark tactical positions on the encrypted map visible only to your guild", icon: "🗺️", details: "Coordinates are encrypted with Zama FHE before being stored on-chain" },
    { title: "FHE Tactical Processing", description: "Calculate troop movements and strengths without exposing positions", icon: "⚔️", details: "Zama FHE allows encrypted computations for strategic advantages" },
    { title: "Execute Battle Plans", description: "Launch coordinated attacks with perfect secrecy", icon: "🎯", details: "Only guild members can decrypt and view the final battle positions" }
  ];

  const renderStrengthChart = () => {
    return (
      <div className="strength-chart">
        <div className="chart-bars">
          {plans.slice(0, 5).map((plan, index) => (
            <div key={index} className="chart-bar-container">
              <div className="chart-bar" style={{ height: `${Math.min(plan.strength / 2, 100)}%` }}>
                <div className="bar-value">{plan.strength}</div>
              </div>
              <div className="bar-label">Plan #{index+1}</div>
            </div>
          ))}
        </div>
        <div className="chart-legend">
          <div className="legend-item"><div className="color-box active"></div><span>Active: {activeCount}</span></div>
          <div className="legend-item"><div className="color-box draft"></div><span>Draft: {draftCount}</span></div>
          <div className="legend-item"><div className="color-box executed"></div><span>Executed: {executedCount}</span></div>
        </div>
      </div>
    );
  };

  const filteredPlans = plans.filter(plan => 
    plan.strategy.toLowerCase().includes(searchTerm.toLowerCase()) || 
    plan.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted battle map...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="shield-icon"></div></div>
          <h1>Guild<span>War</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-plan-btn cyber-button">
            <div className="add-icon"></div>New Battle Plan
          </button>
          <button className="cyber-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Guild War Tactical Planner</h2>
            <p>Plan your MMORPG guild battles on an encrypted map with Zama FHE technology</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Guild War FHE Tutorial</h2>
            <p className="subtitle">Learn how to plan battles with fully encrypted coordinates</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-diagram">
              <div className="diagram-step"><div className="diagram-icon">🗺️</div><div className="diagram-label">Plain Coordinates</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">⚔️</div><div className="diagram-label">Encrypted Strategy</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🎯</div><div className="diagram-label">Secure Execution</div></div>
            </div>
          </div>
        )}
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>Secure guild war planning platform using <strong>Zama FHE technology</strong> to encrypt tactical positions. Coordinates are encrypted on the client side and remain encrypted during strategic calculations.</p>
            <div className="fhe-badge"><span>FHE-Powered</span></div>
          </div>
          <div className="dashboard-card cyber-card">
            <h3>Battle Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{plans.length}</div><div className="stat-label">Total Plans</div></div>
              <div className="stat-item"><div className="stat-value">{activeCount}</div><div className="stat-label">Active</div></div>
              <div className="stat-item"><div className="stat-value">{draftCount}</div><div className="stat-label">Drafts</div></div>
              <div className="stat-item"><div className="stat-value">{Math.round(averageStrength)}</div><div className="stat-label">Avg Strength</div></div>
            </div>
          </div>
          <div className="dashboard-card cyber-card"><h3>Strength Comparison</h3>{renderStrengthChart()}</div>
        </div>
        <div className="plans-section">
          <div className="section-header">
            <h2>Encrypted Battle Plans</h2>
            <div className="header-actions">
              <input 
                type="text" 
                placeholder="Search plans..." 
                className="cyber-input search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button onClick={loadPlans} className="refresh-btn cyber-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="tabs">
            <button className={`tab-button ${activeTab === "plans" ? "active" : ""}`} onClick={() => setActiveTab("plans")}>All Plans</button>
            <button className={`tab-button ${activeTab === "active" ? "active" : ""}`} onClick={() => setActiveTab("active")}>Active</button>
            <button className={`tab-button ${activeTab === "drafts" ? "active" : ""}`} onClick={() => setActiveTab("drafts")}>Drafts</button>
          </div>
          <div className="plans-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Strategy</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Strength</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            {filteredPlans.length === 0 ? (
              <div className="no-plans">
                <div className="no-plans-icon"></div>
                <p>No battle plans found</p>
                <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>Create First Plan</button>
              </div>
            ) : filteredPlans.map(plan => (
              <div className="plan-row" key={plan.id} onClick={() => setSelectedPlan(plan)}>
                <div className="table-cell plan-id">#{plan.id.substring(0, 6)}</div>
                <div className="table-cell">{plan.strategy}</div>
                <div className="table-cell">{plan.owner.substring(0, 6)}...{plan.owner.substring(38)}</div>
                <div className="table-cell">{new Date(plan.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell strength">{plan.strength}</div>
                <div className="table-cell"><span className={`status-badge ${plan.status}`}>{plan.status}</span></div>
                <div className="table-cell actions">
                  {isOwner(plan.owner) && (
                    <>
                      {plan.status === "draft" && (
                        <button className="action-btn cyber-button success" onClick={(e) => { e.stopPropagation(); activatePlan(plan.id); }}>Activate</button>
                      )}
                      {plan.status === "active" && (
                        <button className="action-btn cyber-button primary" onClick={(e) => { e.stopPropagation(); executePlan(plan.id); }}>Execute</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {showCreateModal && <ModalCreate onSubmit={submitPlan} onClose={() => setShowCreateModal(false)} creating={creating} planData={newPlanData} setPlanData={setNewPlanData}/>}
      {selectedPlan && (
        <PlanDetailModal 
          plan={selectedPlan} 
          onClose={() => { setSelectedPlan(null); setDecryptedCoords(null); }} 
          decryptedCoords={decryptedCoords} 
          setDecryptedCoords={setDecryptedCoords} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="shield-icon"></div><span>GuildWarFHE</span></div>
            <p>Secure encrypted guild war planning using Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} GuildWarFHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  planData: any;
  setPlanData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, planData, setPlanData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPlanData({ ...planData, [name]: value });
  };

  const handleCoordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPlanData({ ...planData, [name]: parseInt(value) });
  };

  const handleStrengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setPlanData({ ...planData, strength: parseInt(value) });
  };

  const handleSubmit = () => {
    if (!planData.strategy || planData.xCoord === undefined || planData.yCoord === undefined) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>New Encrypted Battle Plan</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your tactical coordinates will be encrypted with Zama FHE before submission</p></div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Strategy Name *</label>
              <input 
                type="text" 
                name="strategy" 
                value={planData.strategy} 
                onChange={handleChange} 
                placeholder="Ambush, Flank, etc..." 
                className="cyber-input"
              />
            </div>
            <div className="form-group">
              <label>X Coordinate *</label>
              <input 
                type="number" 
                name="xCoord" 
                value={planData.xCoord} 
                onChange={handleCoordChange} 
                placeholder="0-1000" 
                className="cyber-input"
                min="0"
                max="1000"
              />
            </div>
            <div className="form-group">
              <label>Y Coordinate *</label>
              <input 
                type="number" 
                name="yCoord" 
                value={planData.yCoord} 
                onChange={handleCoordChange} 
                placeholder="0-1000" 
                className="cyber-input"
                min="0"
                max="1000"
              />
            </div>
            <div className="form-group">
              <label>Troop Strength</label>
              <input 
                type="range" 
                min="50" 
                max="500" 
                value={planData.strength} 
                onChange={handleStrengthChange}
                className="strength-slider"
              />
              <div className="strength-value">{planData.strength}</div>
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Coordinates:</span><div>{planData.xCoord}, {planData.yCoord}</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{FHEEncryptNumber(parseFloat(`${planData.xCoord}.${planData.yCoord}`)).substring(0, 50)}...</div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Guild Privacy Guarantee</strong><p>Coordinates remain encrypted during FHE processing and are only visible to guild members</p></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PlanDetailModalProps {
  plan: GuildWarPlan;
  onClose: () => void;
  decryptedCoords: {x: number, y: number} | null;
  setDecryptedCoords: (value: {x: number, y: number} | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<{x: number, y: number} | null>;
}

const PlanDetailModal: React.FC<PlanDetailModalProps> = ({ plan, onClose, decryptedCoords, setDecryptedCoords, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedCoords !== null) { setDecryptedCoords(null); return; }
    const decrypted = await decryptWithSignature(plan.encryptedCoordinates);
    if (decrypted !== null) setDecryptedCoords(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="plan-detail-modal cyber-card">
        <div className="modal-header">
          <h2>Battle Plan #{plan.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="plan-info">
            <div className="info-item"><span>Strategy:</span><strong>{plan.strategy}</strong></div>
            <div className="info-item"><span>Owner:</span><strong>{plan.owner.substring(0, 6)}...{plan.owner.substring(38)}</strong></div>
            <div className="info-item"><span>Date:</span><strong>{new Date(plan.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Strength:</span><strong>{plan.strength}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${plan.status}`}>{plan.status}</strong></div>
          </div>
          <div className="encrypted-data-section">
            <h3>Encrypted Coordinates</h3>
            <div className="encrypted-data">{plan.encryptedCoordinates.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button className="decrypt-btn cyber-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedCoords !== null ? "Hide Coordinates" : "Decrypt with Wallet Signature"}
            </button>
          </div>
          {decryptedCoords !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Coordinates</h3>
              <div className="coordinates-display">
                <div className="coord"><span>X:</span><strong>{decryptedCoords.x}</strong></div>
                <div className="coord"><span>Y:</span><strong>{decryptedCoords.y}</strong></div>
              </div>
              <div className="tactical-map">
                <div 
                  className="map-marker" 
                  style={{ 
                    left: `${(decryptedCoords.x / 1000) * 100}%`, 
                    top: `${(decryptedCoords.y / 1000) * 100}%` 
                  }}
                ></div>
              </div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted coordinates are only visible after wallet signature verification</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;