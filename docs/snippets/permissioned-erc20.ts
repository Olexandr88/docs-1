// [!region clients]
import { getRequiredPrefund } from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import {
	createPublicClient,
	encodeFunctionData,
	getAddress,
	getContract,
	type Hex,
	http,
	parseAbi,
} from "viem"
import {
	createBundlerClient,
	entryPoint07Address,
	type EntryPointVersion,
} from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"

const pimlicoUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http("https://sepolia.base.org"),
})
const pimlicoClient = createPimlicoClient({
	transport: http(pimlicoUrl),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7" as EntryPointVersion,
	},
})
const bundlerClient = createBundlerClient({
	account: await toSimpleSmartAccount({
		client: publicClient,
		owner: privateKeyToAccount(process.env.PRIVATE_KEY as Hex),
	}),
	chain: baseSepolia,
	transport: http(pimlicoUrl),
	paymaster: pimlicoClient,
	userOperation: {
		estimateFeesPerGas: async () => {
			return (await pimlicoClient.getUserOperationGasPrice()).fast
		},
	},
})
// [!endregion clients]

// [!region getUserTokens]
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const smartAccountAddress = bundlerClient.account.address

const senderUsdcBalance = await publicClient.readContract({
	abi: parseAbi(["function balanceOf(address account) returns (uint256)"]),
	address: usdc,
	functionName: "balanceOf",
	args: [smartAccountAddress],
})

if (senderUsdcBalance < 1_000_000n) {
	throw new Error("insufficient USDC balance, required at least 1 USDC.")
}
// [!endregion getUserTokens]

// [!region getTokenQuotes]
const quotes = await pimlicoClient.getTokenQuotes({
	tokens: [usdc],
	chainId: baseSepolia.id,
})
const { postOpGas, exchangeRate, paymaster } = quotes[0]

let calls = [
	{
		to: getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
		data: "0x1234" as Hex,
	},
]

const userOperation = await bundlerClient.prepareUserOperation({
	calls,
})

const paymasterContract = getContract({
	address: paymaster,
	abi: parseAbi([
		"function getCostInToken(uint256 _actualGasCost, uint256 _postOpGas, uint256 _actualUserOpFeePerGas, uint256 _exchangeRate) public pure returns (uint256)",
	]),
	client: publicClient,
})

const maxCostInToken = await paymasterContract.read.getCostInToken([
	getRequiredPrefund({ userOperation, entryPointVersion: "0.7" }),
	postOpGas,
	userOperation.maxFeePerGas,
	exchangeRate,
])
// [!endregion getTokenQuotes]

// [!region sendUserOperation]
calls = [
	{
		to: usdc,
		data: encodeFunctionData({
			abi: parseAbi(["function approve(address,uint)"]),
			args: [paymaster, maxCostInToken],
		}),
	},
	{
		to: getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
		data: "0x1234" as Hex,
	},
]

const hash = await bundlerClient.sendUserOperation({
	paymasterContext: {
		token: usdc,
	},
	calls,
})

const opReceipt = await bundlerClient.waitForUserOperationReceipt({
	hash,
})

console.log(`transactionHash: ${opReceipt.receipt.transactionHash}`)
// [!endregion sendUserOperation]