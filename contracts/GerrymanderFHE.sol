// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GerrymanderFHE is SepoliaConfig {
    struct DistrictData {
        euint32 encryptedVoterCount;
        euint32 encryptedPartyAVotes;
        euint32 encryptedPartyBVotes;
        euint32 encryptedDistrictId;
    }

    struct AnalysisResult {
        euint32 encryptedEfficiencyGap;
        euint32 encryptedPartisanBias;
        bool isRevealed;
    }

    struct DistrictGroup {
        euint32 encryptedTotalVotes;
        euint32 encryptedWastedVotesA;
        euint32 encryptedWastedVotesB;
    }

    uint256 public districtCount;
    uint256 public analysisCount;
    mapping(uint256 => DistrictData) public districts;
    mapping(uint256 => AnalysisResult) public analyses;
    mapping(uint32 => DistrictGroup) public districtGroups;
    mapping(uint256 => uint256) private requestToDistrictId;
    mapping(uint256 => uint256) private requestToAnalysisId;
    
    event DistrictSubmitted(uint256 indexed districtId);
    event AnalysisRequested(uint256 indexed districtGroup);
    event GerrymanderDetected(uint256 indexed analysisId);
    event AnalysisRevealed(uint256 indexed analysisId);

    function submitDistrictData(
        euint32 voterCount,
        euint32 partyAVotes,
        euint32 partyBVotes,
        euint32 districtId
    ) public {
        districtCount++;
        districts[districtCount] = DistrictData({
            encryptedVoterCount: voterCount,
            encryptedPartyAVotes: partyAVotes,
            encryptedPartyBVotes: partyBVotes,
            encryptedDistrictId: districtId
        });
        emit DistrictSubmitted(districtCount);
    }

    function analyzeDistrictGroup(uint32 groupId) public {
        require(districtGroups[groupId].encryptedTotalVotes == FHE.asEuint32(0), "Group exists");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(districts[districtCount].encryptedPartyAVotes);
        ciphertexts[1] = FHE.toBytes32(districts[districtCount].encryptedPartyBVotes);
        ciphertexts[2] = FHE.toBytes32(districts[districtCount].encryptedVoterCount);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateMetrics.selector);
        requestToDistrictId[reqId] = districtCount;
        requestToAnalysisId[reqId] = groupId;
    }

    function calculateMetrics(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 districtId = requestToDistrictId[requestId];
        uint32 groupId = uint32(requestToAnalysisId[requestId]);
        require(districtId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory voteData = abi.decode(cleartexts, (uint32[]));
        uint32 partyAVotes = voteData[0];
        uint32 partyBVotes = voteData[1];
        uint32 totalVoters = voteData[2];

        // Calculate wasted votes (simplified)
        uint32 wastedA = partyAVotes > partyBVotes ? 
            (partyAVotes - ((partyAVotes + partyBVotes)/2 + 1)) : partyAVotes;
        uint32 wastedB = partyBVotes > partyAVotes ? 
            (partyBVotes - ((partyAVotes + partyBVotes)/2 + 1)) : partyBVotes;

        // Update district group stats
        districtGroups[groupId].encryptedTotalVotes = FHE.add(
            districtGroups[groupId].encryptedTotalVotes,
            FHE.asEuint32(totalVoters)
        );
        districtGroups[groupId].encryptedWastedVotesA = FHE.add(
            districtGroups[groupId].encryptedWastedVotesA,
            FHE.asEuint32(wastedA)
        );
        districtGroups[groupId].encryptedWastedVotesB = FHE.add(
            districtGroups[groupId].encryptedWastedVotesB,
            FHE.asEuint32(wastedB)
        );
    }

    function detectGerrymandering(uint32 groupId) public {
        require(districtGroups[groupId].encryptedTotalVotes != FHE.asEuint32(0), "No data");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(districtGroups[groupId].encryptedTotalVotes);
        ciphertexts[1] = FHE.toBytes32(districtGroups[groupId].encryptedWastedVotesA);
        ciphertexts[2] = FHE.toBytes32(districtGroups[groupId].encryptedWastedVotesB);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateEfficiencyGap.selector);
        requestToAnalysisId[reqId] = groupId;
    }

    function calculateEfficiencyGap(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint32 groupId = uint32(requestToAnalysisId[requestId]);
        require(groupId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory stats = abi.decode(cleartexts, (uint32[]));
        uint32 totalVotes = stats[0];
        uint32 wastedA = stats[1];
        uint32 wastedB = stats[2];

        // Calculate efficiency gap
        int32 efficiencyGap = (int32(wastedB) - int32(wastedA)) * 100 / int32(totalVotes);
        uint32 absoluteGap = efficiencyGap < 0 ? uint32(-efficiencyGap) : uint32(efficiencyGap);

        analysisCount++;
        analyses[analysisCount] = AnalysisResult({
            encryptedEfficiencyGap: FHE.asEuint32(absoluteGap),
            encryptedPartisanBias: FHE.asEuint32(0), // Would calculate in real implementation
            isRevealed: false
        });

        if (absoluteGap > 7) { // Threshold for significant gerrymandering
            emit GerrymanderDetected(analysisCount);
        }
    }

    function requestAnalysisDecryption(uint256 analysisId) public {
        require(analysisId <= analysisCount, "Invalid analysis");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(analyses[analysisId].encryptedEfficiencyGap);
        ciphertexts[1] = FHE.toBytes32(analyses[analysisId].encryptedPartisanBias);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
        requestToAnalysisId[reqId] = analysisId;
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 analysisId = requestToAnalysisId[requestId];
        require(analysisId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        analyses[analysisId].isRevealed = true;
        
        emit AnalysisRevealed(analysisId);
    }

    function getDistrictCount() public view returns (uint256) {
        return districtCount;
    }

    function getAnalysisStatus(uint256 analysisId) public view returns (bool) {
        return analyses[analysisId].isRevealed;
    }
}