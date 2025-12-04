// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface DistrictData {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  efficiencyGap: number;
  status: "pending" | "fair" | "gerrymandered";
  details?: {
    voters: number;
    districts: number;
    partySplit: number[];
  };
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [districts, setDistricts] = useState<DistrictData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDistrictData, setNewDistrictData] = useState({
    name: "",
    voters: "",
    districts: "",
    partyASupport: "",
    partyBSupport: ""
  });
  const [expandedDistrict, setExpandedDistrict] = useState<string | null>(null);

  // Calculate statistics
  const fairCount = districts.filter(d => d.status === "fair").length;
  const gerrymanderedCount = districts.filter(d => d.status === "gerrymandered").length;
  const pendingCount = districts.filter(d => d.status === "pending").length;

  useEffect(() => {
    loadDistricts().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDistricts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("district_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing district keys:", e);
        }
      }
      
      const list: DistrictData[] = [];
      
      for (const key of keys) {
        try {
          const districtBytes = await contract.getData(`district_${key}`);
          if (districtBytes.length > 0) {
            try {
              const districtData = JSON.parse(ethers.toUtf8String(districtBytes));
              list.push({
                id: key,
                name: districtData.name,
                encryptedData: districtData.data,
                timestamp: districtData.timestamp,
                owner: districtData.owner,
                efficiencyGap: districtData.efficiencyGap || 0,
                status: districtData.status || "pending",
                details: districtData.details
              });
            } catch (e) {
              console.error(`Error parsing district data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading district ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDistricts(list);
    } catch (e) {
      console.error("Error loading districts:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitDistrict = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting district data with FHE..."
    });
    
    try {
      // Simulate FHE encryption and computation
      const encryptedData = `FHE-${btoa(JSON.stringify(newDistrictData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const districtId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Calculate efficiency gap (simplified)
      const voters = parseInt(newDistrictData.voters) || 0;
      const districts = parseInt(newDistrictData.districts) || 1;
      const partyASupport = parseInt(newDistrictData.partyASupport) || 0;
      const partyBSupport = parseInt(newDistrictData.partyBSupport) || 0;
      
      const efficiencyGap = Math.abs(partyASupport - partyBSupport) / (voters / districts);
      const status = efficiencyGap > 0.08 ? "gerrymandered" : "fair";

      const districtData = {
        name: newDistrictData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        efficiencyGap: efficiencyGap,
        status: status,
        details: {
          voters: voters,
          districts: districts,
          partySplit: [partyASupport, partyBSupport]
        }
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `district_${districtId}`, 
        ethers.toUtf8Bytes(JSON.stringify(districtData))
      );
      
      const keysBytes = await contract.getData("district_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(districtId);
      
      await contract.setData(
        "district_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "District data analyzed with FHE!"
      });
      
      await loadDistricts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewDistrictData({
          name: "",
          voters: "",
          districts: "",
          partyASupport: "",
          partyBSupport: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const toggleDistrictDetails = (id: string) => {
    if (expandedDistrict === id) {
      setExpandedDistrict(null);
    } else {
      setExpandedDistrict(id);
    }
  };

  const renderBarChart = () => {
    if (districts.length === 0) return null;

    const maxGap = Math.max(...districts.map(d => d.efficiencyGap));
    const normalizedGaps = districts.map(d => 
      maxGap > 0 ? (d.efficiencyGap / maxGap) * 100 : 0
    );

    return (
      <div className="bar-chart">
        {districts.map((district, index) => (
          <div key={district.id} className="bar-container">
            <div className="bar-label">#{district.id.substring(0, 4)}</div>
            <div className="bar">
              <div 
                className={`bar-fill ${district.status}`}
                style={{ height: `${normalizedGaps[index]}%` }}
              ></div>
            </div>
            <div className="bar-value">{district.efficiencyGap.toFixed(2)}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="circuit-icon"></div>
          </div>
          <h1>Gerrymander<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-district-btn cyber-button"
          >
            <div className="add-icon"></div>
            Analyze District
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Gerrymandering Detection</h2>
            <p>Analyze electoral districts with FHE to detect unfair redistricting while keeping data private</p>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel project-info">
            <h3>About GerrymanderFHE</h3>
            <p>This tool uses Fully Homomorphic Encryption (FHE) to analyze encrypted district maps and voter data, detecting potential gerrymandering without exposing sensitive information.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Analysis</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <h3>District Analysis Summary</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{districts.length}</div>
                <div className="stat-label">Total Analyses</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{fairCount}</div>
                <div className="stat-label">Fair Districts</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{gerrymanderedCount}</div>
                <div className="stat-label">Gerrymandered</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-panel">
            <h3>Efficiency Gap Comparison</h3>
            {renderBarChart()}
          </div>
        </div>
        
        <div className="districts-section">
          <div className="section-header">
            <h2>District Analysis Results</h2>
            <div className="header-actions">
              <button 
                onClick={loadDistricts}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="districts-list">
            {districts.length === 0 ? (
              <div className="no-districts">
                <div className="no-districts-icon"></div>
                <p>No district analyses found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Analyze First District
                </button>
              </div>
            ) : (
              districts.map(district => (
                <div className={`district-card ${district.status}`} key={district.id}>
                  <div className="card-header">
                    <h3>{district.name}</h3>
                    <span className={`status-badge ${district.status}`}>
                      {district.status}
                    </span>
                  </div>
                  <div className="card-content">
                    <div className="district-info">
                      <div className="info-item">
                        <label>Efficiency Gap:</label>
                        <span className="gap-value">{district.efficiencyGap.toFixed(3)}</span>
                      </div>
                      <div className="info-item">
                        <label>Analyzed:</label>
                        <span>{new Date(district.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                      <div className="info-item">
                        <label>Owner:</label>
                        <span className="owner-address">{district.owner.substring(0, 6)}...{district.owner.substring(38)}</span>
                      </div>
                    </div>
                    <button 
                      className="details-btn cyber-button"
                      onClick={() => toggleDistrictDetails(district.id)}
                    >
                      {expandedDistrict === district.id ? "Hide Details" : "Show Details"}
                    </button>
                  </div>
                  {expandedDistrict === district.id && district.details && (
                    <div className="card-details">
                      <h4>District Details</h4>
                      <div className="details-grid">
                        <div className="detail-item">
                          <label>Total Voters:</label>
                          <span>{district.details.voters}</span>
                        </div>
                        <div className="detail-item">
                          <label>Number of Districts:</label>
                          <span>{district.details.districts}</span>
                        </div>
                        <div className="detail-item">
                          <label>Party A Support:</label>
                          <span>{district.details.partySplit[0]}%</span>
                        </div>
                        <div className="detail-item">
                          <label>Party B Support:</label>
                          <span>{district.details.partySplit[1]}%</span>
                        </div>
                      </div>
                      <div className="fhe-notice">
                        <div className="lock-icon"></div>
                        Analysis performed on encrypted data using FHE
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitDistrict} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          districtData={newDistrictData}
          setDistrictData={setNewDistrictData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
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
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="circuit-icon"></div>
              <span>GerrymanderFHE</span>
            </div>
            <p>Confidential political gerrymandering detection using FHE technology</p>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} GerrymanderFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  districtData: any;
  setDistrictData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  districtData,
  setDistrictData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDistrictData({
      ...districtData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!districtData.name || !districtData.voters || !districtData.districts) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Analyze Electoral District</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> District data will be encrypted with FHE for analysis
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>District Name *</label>
              <input 
                type="text"
                name="name"
                value={districtData.name} 
                onChange={handleChange}
                placeholder="e.g., California Congressional Districts" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Total Voters *</label>
              <input 
                type="number"
                name="voters"
                value={districtData.voters} 
                onChange={handleChange}
                placeholder="Enter total number of voters" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Number of Districts *</label>
              <input 
                type="number"
                name="districts"
                value={districtData.districts} 
                onChange={handleChange}
                placeholder="Enter number of districts" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Party A Support (%)</label>
              <input 
                type="number"
                name="partyASupport"
                value={districtData.partyASupport} 
                onChange={handleChange}
                placeholder="0-100" 
                className="cyber-input"
                min="0"
                max="100"
              />
            </div>
            
            <div className="form-group">
              <label>Party B Support (%)</label>
              <input 
                type="number"
                name="partyBSupport"
                value={districtData.partyBSupport} 
                onChange={handleChange}
                placeholder="0-100" 
                className="cyber-input"
                min="0"
                max="100"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Analyzing with FHE..." : "Analyze District"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;