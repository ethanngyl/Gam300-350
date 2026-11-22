#pragma once

#include "../Manager/StressTestRunner.h"

#include <QWidget>

#include <vector>

class QLabel;
class QTableWidget;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

	//Appends one row per result to the table
	void AddResults(const std::vector<StressResult>& results);

	//Singal to run various stress tests
signals:
	void loadTestRequested();
	void selectTestRequested();

private:
	//Shows the explanation of the selected row under the table, or a hint if no row is selected
	void ShowSelectedDescription();

	QTableWidget* m_results = nullptr;
	QLabel* m_description = nullptr;
};
