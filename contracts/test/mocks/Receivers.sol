// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RejectingReceiver {
    receive() external payable {
        revert("no");
    }
}

contract PaymentReceiver {
    receive() external payable {}

    function refund(address payable to, uint256 amount) external {
        (bool ok,) = to.call{value: amount}("");
        require(ok);
    }
}
